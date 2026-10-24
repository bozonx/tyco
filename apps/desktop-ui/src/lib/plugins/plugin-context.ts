import {
  clonePluginValue,
  validateContribution,
  validateToolResult,
  validateToolSchema,
  validateParseResult,
  type PluginDisposer,
  type ToolbarContribution,
  type ToolResult,
  validatePluginFields,
  isPluginError,
  PluginError,
  PluginCancellation,
  type PluginCapability,
  type PluginContext,
  type ToolDefinition,
  type EditorInputSnapshot,
} from '@tyco/plugin-sdk'

import type { ActionItem, EditItem, ToolbarItem } from '../../types/plugins'
import { createPluginAction } from './plugin-action'
import type { ToolDefinition as HostToolDefinition } from '../tools/tool-types'
import type { PluginLifecycle } from './plugin-manager'
import {
  pluginIconName,
  pluginMessageKey,
  scopeConfigFields,
} from './plugin-resources'

const MAX_CONTRIBUTION_BATCH = 256
const MAX_TOTAL_CONTRIBUTIONS = 1024

export interface PluginContextDependencies {
  registerActionsItems(items: ActionItem[]): PluginDisposer | void
  registerEditItems(items: EditItem[]): PluginDisposer | void
  registerCaseItems(items: EditItem[]): PluginDisposer | void
  registerFormatItems(items: EditItem[]): PluginDisposer | void
  registerToolbarItems(items: ToolbarItem[]): PluginDisposer | void
  registerTools(
    tools: HostToolDefinition[],
    config: () => Record<string, unknown>
  ): PluginDisposer | void
  invokeTool?(
    toolId: string,
    snapshot: EditorInputSnapshot,
    signal: AbortSignal
  ): Promise<ToolResult>
  getEditorInputValue(): string
  getEditorInputSelectedText(): string
  getEditorInputSnapshot(): EditorInputSnapshot
  applyEditorInputEdit(
    snapshot: EditorInputSnapshot,
    value: string,
    scope: 'selection' | 'document'
  ): boolean
  setEditorInputValue(value: string): void
  replaceEditorInputSelection(value: string): void
  setEditorInputFocus(): void
  toEditor(text?: string): void
  toastKey(
    messageKey: string,
    type: 'success' | 'error' | 'warn' | 'info'
  ): void
  toastText(message: string, type: 'success' | 'error' | 'warn' | 'info'): void
  t(key: string, params?: Record<string, string | number>): string
  log: PluginContext['log']
  /**
   * The one desktop function a plugin reaches as it is; notes go through
   * `writeNote`
   */
  openInBrowserAndHide(
    url: string
  ): Promise<{ success: boolean; error?: string }>
  writeNote?(
    id: string,
    dir: string,
    fileName: string,
    text: string,
    append: boolean
  ): Promise<{ success: boolean; result?: string; error?: string }>
}

/** The sole adapter from SDK operations to host services. */
export function createPluginContext(
  id: string,
  config: () => Record<string, unknown>,
  lifecycle: PluginLifecycle,
  deps: PluginContextDependencies
): PluginContext {
  const ids = new Set<string>()
  const key = (value: string) => pluginMessageKey(id, value)!
  const check = (capability?: PluginCapability) => {
    if (lifecycle.signal.aborted)
      throw new PluginCancellation(`Plugin ${id} is disposed`)
    if (capability && !lifecycle.capabilities.includes(capability))
      throw new Error(`Plugin ${id} requires ${capability}`)
  }
  const guard =
    <A extends unknown[], R>(
      fn: (...args: A) => R,
      capability?: PluginCapability
    ) =>
    (...args: A): R => {
      check(capability)
      return fn(...args)
    }
  function scope<T extends { id?: string; labelKey?: string }>(
    kind: 'action' | 'edit' | 'toolbar' | 'tool',
    items: T[]
  ): T[] {
    check()
    if (
      !Array.isArray(items) ||
      items.length > MAX_CONTRIBUTION_BATCH ||
      ids.size + items.length > MAX_TOTAL_CONTRIBUTIONS
    )
      throw new Error('Too many plugin contributions')
    const next = new Set(ids)
    const result = items.map((item) => {
      validateContribution(item, kind)
      const local = `${kind}:${item.id}`
      if (next.has(local)) throw new Error(`Duplicate ${kind} ID: ${item.id}`)
      next.add(local)
      return {
        ...item,
        ownerPluginId: id,
        id: `${id}:${item.id}`,
        labelKey: item.labelKey ? key(item.labelKey) : undefined,
        icon: pluginIconName(
          id,
          (item as { icon?: string }).icon,
          lifecycle.iconPrefix
        ),
      }
    })
    for (const value of next) ids.add(value)
    return result
  }
  function registration<T extends { id?: string; labelKey?: string }, R>(
    kind: 'action' | 'edit' | 'toolbar' | 'tool',
    items: T[],
    build: (scoped: T[]) => R[],
    register: (items: R[]) => PluginDisposer | void
  ): PluginDisposer {
    const scoped = scope(kind, items)
    const reserved = items.map((item) => `${kind}:${item.id}`)
    const releaseIds = () => {
      for (const localId of reserved) ids.delete(localId)
    }
    try {
      const dispose = register(build(scoped))
      let released = false
      return () => {
        if (released || lifecycle.signal.aborted) return undefined
        released = true
        try {
          const result = dispose?.()
          if (result) return Promise.resolve(result).finally(releaseIds)
          releaseIds()
          return undefined
        } catch (error) {
          releaseIds()
          throw error
        }
      }
    } catch (error) {
      releaseIds()
      throw error
    }
  }
  function uiAction<A extends unknown[]>(
    action: (...args: A) => void | Promise<void>,
    scopedErrors = false
  ) {
    const execution = createPluginAction(action, {
      signal: lifecycle.signal,
      reportError: (error) => deps.log('error', 'Plugin action failed', error),
      toast: (message) =>
        deps.toastKey(scopedErrors ? message : key(message), 'error'),
    })
    return {
      get isRunning() {
        return execution.state.isRunning
      },
      action: execution.run,
    }
  }
  function edit(
    items: EditItem[],
    register: (items: EditItem[]) => PluginDisposer | void
  ) {
    return registration(
      'edit',
      items,
      (scoped) =>
        scoped.map((item) => ({
          ...item,
          action: async (text: string) => {
            check('editor')
            try {
              const result = await item.action(text)
              check()
              if (typeof result !== 'string')
                throw new Error('Invalid text transform result')
              return result
            } catch (error) {
              check()
              if (isPluginError(error))
                throw new PluginError(key(error.messageKey))
              throw error
            }
          },
        })),
      register
    )
  }
  function tool(definition: ToolDefinition): HostToolDefinition {
    return {
      ...definition,
      icon: pluginIconName(id, definition.icon, lifecycle.iconPrefix),
      labelKey: definition.labelKey ? key(definition.labelKey) : undefined,
      descriptionKey: definition.descriptionKey
        ? key(definition.descriptionKey)
        : undefined,
      defaultPhrasesKey: definition.defaultPhrasesKey
        ? key(definition.defaultPhrasesKey)
        : undefined,
      configFields: scopeConfigFields(id, definition.configFields),
      configPresets: lifecycle.configPresets,
      getUnavailableReasonKey: () =>
        lifecycle.signal.aborted ? 'toast.commandUnavailable' : undefined,
      parseText: definition.parseText
        ? async (text, context) => {
            check()
            try {
              const result = await definition.parseText!(text, {
                ...context,
                signal: AbortSignal.any([context.signal, lifecycle.signal]),
              })
              check()
              validateParseResult(result)
              return result.ok
                ? result
                : {
                    ...result,
                    messageKey: pluginMessageKey(id, result.messageKey),
                  }
            } catch (error) {
              check()
              if (isPluginError(error))
                throw new PluginError(key(error.messageKey))
              throw error
            }
          }
        : undefined,
      run: async (call) => {
        check()
        const signal = AbortSignal.any([call.signal, lifecycle.signal])
        try {
          const result = await definition.run({ ...call, signal })
          if (signal.aborted) return { ok: false, cancelled: true }
          validateToolResult(result)
          return {
            ...result,
            messageKey: pluginMessageKey(id, result.messageKey),
          }
        } catch (error) {
          if (signal.aborted) return { ok: false, cancelled: true }
          if (isPluginError(error))
            return { ok: false, messageKey: key(error.messageKey) }
          throw error
        }
      },
    }
  }
  return {
    signal: lifecycle.signal,
    onDispose: lifecycle.onDispose,
    registerActionsItems: (items) =>
      registration(
        'action',
        items,
        (scoped) =>
          scoped.map((item) => {
            const execution = uiAction(item.action)
            return {
              ...item,
              get disabled() {
                return Boolean(item.disabled || execution.isRunning)
              },
              get isRunning() {
                return execution.isRunning
              },
              action: execution.action,
            }
          }),
        deps.registerActionsItems
      ),
    registerEditItems: (items) => edit(items, deps.registerEditItems),
    registerCaseItems: (items) => edit(items, deps.registerCaseItems),
    registerFormatItems: (items) => edit(items, deps.registerFormatItems),
    registerToolbarItems: (items: ToolbarContribution[]) =>
      registration(
        'toolbar',
        items,
        (scoped) =>
          scoped.map((item): ToolbarItem => {
            const action =
              item.toolId !== undefined
                ? async () => {
                    check('editor')
                    const snapshot = deps.getEditorInputSnapshot()
                    if (!deps.invokeTool)
                      throw new Error('Tool invocation is unavailable')
                    const result = await deps.invokeTool(
                      `${id}.${item.toolId}`,
                      snapshot,
                      lifecycle.signal
                    )
                    if (lifecycle.signal.aborted || result.cancelled) return
                    const level =
                      result.level ?? (result.ok ? 'success' : 'error')
                    if (result.messageKey)
                      deps.toastKey(result.messageKey, level)
                    if (result.message) deps.toastText(result.message, level)
                  }
                : item.action!
            const execution = uiAction(action, item.toolId !== undefined)
            return {
              ...item,
              tooltipKey: item.tooltipKey ? key(item.tooltipKey) : undefined,
              get disabled() {
                return Boolean(item.disabled || execution.isRunning)
              },
              get isRunning() {
                return execution.isRunning
              },
              action: execution.action,
            }
          }),
        deps.registerToolbarItems
      ),
    registerTools: (items) => {
      if (!Array.isArray(items) || items.length > 256)
        throw new Error('Too many plugin contributions')
      for (const definition of items) {
        validateContribution(definition, 'tool')
        if (
          typeof definition.run !== 'function' ||
          typeof definition.description !== 'string' ||
          !definition.inputSchema ||
          typeof definition.inputSchema !== 'object'
        )
          throw new Error('Invalid plugin tool')
        validateToolSchema(definition.inputSchema)
        if (
          definition.parseText !== undefined &&
          typeof definition.parseText !== 'function'
        )
          throw new Error('Invalid plugin parser')
        if (definition.configFields)
          validatePluginFields(definition.configFields)
        if (lifecycle.capabilities.includes('notes')) {
          const directoryField = lifecycle.notesDirectoryField ?? 'pathToNotes'
          const field = definition.configFields?.find(
            (field) => field.name === directoryField
          )
          if (
            field &&
            (field.type !== 'text' ||
              field.defaultValue !== '' ||
              (field.value !== undefined && field.value !== ''))
          )
            throw new Error('Plugin tools cannot grant notes access')
        }
      }
      // Tools use dot-separated IDs; reserve them in the same owned registry.
      return registration(
        'tool',
        items,
        () => items.map(tool),
        (definitions) => deps.registerTools(definitions, config)
      )
    },
    getEditorInputValue: async () =>
      guard(deps.getEditorInputValue, 'editor')(),
    getEditorInputSelectedText: async () =>
      guard(deps.getEditorInputSelectedText, 'editor')(),
    getEditorInputSnapshot: async () =>
      guard(deps.getEditorInputSnapshot, 'editor')(),
    applyEditorInputEdit: async (snapshot, value, scope) => {
      check('editor')
      if (
        !snapshot ||
        typeof snapshot.value !== 'string' ||
        typeof snapshot.selectedText !== 'string' ||
        !Number.isSafeInteger(snapshot.revision) ||
        snapshot.revision < 0 ||
        !Number.isSafeInteger(snapshot.selectionStart) ||
        !Number.isSafeInteger(snapshot.selectionEnd) ||
        snapshot.selectionStart < 0 ||
        snapshot.selectionEnd < snapshot.selectionStart ||
        snapshot.selectionEnd > snapshot.value.length ||
        typeof value !== 'string' ||
        !['selection', 'document'].includes(scope)
      )
        throw new Error('Invalid conditional editor edit')
      return deps.applyEditorInputEdit(snapshot, value, scope)
    },
    setEditorInputValue: guard(deps.setEditorInputValue, 'editor'),
    replaceEditorInputSelection: guard(
      deps.replaceEditorInputSelection,
      'editor'
    ),
    setEditorInputFocus: guard(deps.setEditorInputFocus, 'editor'),
    toEditor: guard(deps.toEditor, 'editor'),
    t: guard((value, params) => deps.t(key(value), params)),
    toast: guard((value, level) => deps.toastKey(key(value), level)),
    toastText: guard(deps.toastText),
    log: guard(deps.log),
    getMyConfig: guard(() =>
      clonePluginValue(config())
    ) as PluginContext['getMyConfig'],
    callApiFunction: async (name, args) => {
      const capability =
        name === 'openInBrowserAndHide'
          ? 'browser'
          : name === 'saveNote' || name === 'appendNote'
            ? 'notes'
            : undefined
      if (!capability)
        return {
          success: false,
          error: `Desktop function "${name}" is not available to plugins`,
        }
      check(capability)
      if (
        !Array.isArray(args) ||
        args.length !== (capability === 'browser' ? 1 : 3) ||
        args.some((arg) => typeof arg !== 'string')
      )
        throw new Error('Invalid desktop function arguments')
      const result =
        capability === 'notes'
          ? await (deps.writeNote
              ? deps.writeNote(
                  id,
                  args[0]!,
                  args[1]!,
                  args[2]!,
                  name === 'appendNote'
                )
              : Promise.reject(
                  new Error('Scoped notes service is unavailable')
                ))
          : await deps.openInBrowserAndHide(args[0]!)
      check()
      return result
    },
  }
}
