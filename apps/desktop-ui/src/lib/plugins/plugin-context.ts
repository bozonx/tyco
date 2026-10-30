import {
  clonePluginValue,
  type ActionContribution,
  type PluginDisposer,
  type ToolbarContribution,
  type ToolResult,
  isPluginError,
  PluginError,
  PluginCancellation,
  type PluginCapability,
  type PluginContext,
  type EditorInputSnapshot,
} from '@tyco/plugin-sdk'

import type { ActionItem, EditItem, ToolbarItem } from '../../types/plugins'
import { createPluginAction } from './plugin-action'
import type { ToolDefinition as HostToolDefinition } from '../tools/tool-types'
import type { PluginLifecycle } from './plugin-manager'
import { pluginMessageKey } from './plugin-resources'
import { createPluginRegistration } from './plugin-registration'
import { createPluginToolAdapter } from './plugin-tool-adapter'

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
  invokeActionTool?(
    toolId: string,
    text: string,
    signal: AbortSignal
  ): Promise<void>
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
  const registration = createPluginRegistration(id, lifecycle, check)
  const tools = createPluginToolAdapter(id, lifecycle, check)

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
  return {
    signal: lifecycle.signal,
    onDispose: lifecycle.onDispose,
    registerActionsItems: (items: ActionContribution[]) =>
      registration(
        'action',
        items,
        (scoped) =>
          scoped.map((item): ActionItem => {
            const action =
              item.toolId !== undefined
                ? async (text: string) => {
                    check()
                    if (!deps.invokeActionTool)
                      throw new Error('Tool invocation is unavailable')
                    await deps.invokeActionTool(
                      `${id}.${item.toolId}`,
                      text,
                      lifecycle.signal
                    )
                  }
                : item.action!
            const execution = uiAction(action, item.toolId !== undefined)
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
      tools.validate(items)
      // Tools use dot-separated IDs; reserve them in the same owned registry.
      return registration(
        'tool',
        items,
        () => items.map(tools.adapt),
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
