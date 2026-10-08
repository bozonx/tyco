import {
  clonePluginValue,
  validatePluginFields,
  isPluginError,
  PluginError,
  PluginCancellation,
  type ActionItem,
  type EditItem,
  type PluginCapability,
  type PluginContext,
  type ToolDefinition,
  type ToolbarItem,
} from '@tyco/plugin-sdk'

import type { ToolDefinition as HostToolDefinition } from '../tools/tool-types'
import type { PluginLifecycle } from './plugin-manager'
import { linkPluginSignals } from './plugin-signals'
import {
  pluginIconName,
  pluginMessageKey,
  scopeConfigFields,
} from './plugin-resources'

export interface PluginContextDependencies {
  registerActionsItems(items: ActionItem[]): void
  registerEditItems(items: EditItem[]): void
  registerCaseItems(items: EditItem[]): void
  registerFormatItems(items: EditItem[]): void
  registerToolbarItems(items: ToolbarItem[]): void
  registerTools(
    tools: HostToolDefinition[],
    config: () => Record<string, unknown>
  ): void
  getEditorInputValue(): string
  getEditorInputSelectedText(): string
  setEditorInputValue(value: string): void
  replaceEditorInputSelection(value: string): void
  setEditorInputFocus(): void
  toEditor(text?: string): void
  toast(message: string, type: 'success' | 'error' | 'warn' | 'info'): void
  toastText(message: string, type: 'success' | 'error' | 'warn' | 'info'): void
  t(key: string, params?: Record<string, string | number>): string
  log: PluginContext['log']
  callApiFunction: PluginContext['callApiFunction']
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
    kind: string,
    items: T[]
  ): T[] {
    check()
    if (
      !Array.isArray(items) ||
      items.length > 256 ||
      ids.size + items.length > 1024
    )
      throw new Error('Too many plugin contributions')
    const next = new Set(ids)
    const result = items.map((item) => {
      if (!item.id || !/^[A-Za-z0-9_-]+$/.test(item.id))
        throw new Error(`Invalid ${kind} ID: ${item.id}`)
      if (
        ['action', 'edit', 'toolbar'].includes(kind) &&
        typeof (item as { action?: unknown }).action !== 'function'
      )
        throw new Error('Missing plugin callback')
      const local = `${kind}:${item.id}`
      if (next.has(local)) throw new Error(`Duplicate ${kind} ID: ${item.id}`)
      next.add(local)
      return {
        ...item,
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
  function edit(items: EditItem[], register: (items: EditItem[]) => void) {
    register(
      scope('edit', items).map((item) => ({
        ...item,
        action: async (text) => {
          check('editor')
          try {
            const result = await item.action(text)
            check()
            return result
          } catch (error) {
            check()
            if (isPluginError(error))
              throw new PluginError(key(error.messageKey))
            throw error
          }
        },
      }))
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
      defaultCommands: definition.defaultCommands
        ? ({ t }) =>
            definition.defaultCommands!.map((preset) => ({
              ...preset,
              name: preset.nameKey
                ? t(key(preset.nameKey))
                : (preset.name ?? preset.id),
              phrases: preset.phrasesKey
                ? t(key(preset.phrasesKey)).split('\n')
                : preset.phrases,
            }))
        : undefined,
      unavailableReason: () =>
        lifecycle.signal.aborted ? 'toast.commandUnavailable' : undefined,
      parseText: definition.parseText
        ? async (text, context) => {
            check()
            const linked = linkPluginSignals([context.signal, lifecycle.signal])
            try {
              const result = await definition.parseText!(text, {
                ...context,
                signal: linked.signal,
              })
              return result.ok
                ? result
                : {
                    ...result,
                    messageKey: pluginMessageKey(id, result.messageKey),
                  }
            } finally {
              linked.dispose()
            }
          }
        : undefined,
      run: async (call) => {
        check()
        const linked = linkPluginSignals([call.signal, lifecycle.signal])
        try {
          const result = await definition.run({
            ...call,
            signal: linked.signal,
          })
          if (linked.signal.aborted) return { ok: false, cancelled: true }
          return {
            ...result,
            messageKey: pluginMessageKey(id, result.messageKey),
          }
        } catch (error) {
          if (linked.signal.aborted) return { ok: false, cancelled: true }
          if (isPluginError(error))
            return { ok: false, messageKey: key(error.messageKey) }
          throw error
        } finally {
          linked.dispose()
        }
      },
    }
  }
  return {
    signal: lifecycle.signal,
    onDispose: lifecycle.onDispose,
    registerActionsItems: (items) =>
      deps.registerActionsItems(
        scope('action', items).map((item) => ({
          ...item,
          action: guard(item.action),
        }))
      ),
    registerEditItems: (items) => edit(items, deps.registerEditItems),
    registerCaseItems: (items) => edit(items, deps.registerCaseItems),
    registerFormatItems: (items) => edit(items, deps.registerFormatItems),
    registerToolbarItems: (items: ToolbarItem[]) =>
      deps.registerToolbarItems(
        scope('toolbar', items).map((item) => ({
          ...item,
          tooltipKey: item.tooltipKey ? key(item.tooltipKey) : undefined,
          action: guard(item.action),
        }))
      ),
    registerTools: (items) => {
      for (const definition of items) {
        if (
          typeof definition.run !== 'function' ||
          typeof definition.description !== 'string' ||
          !definition.inputSchema ||
          typeof definition.inputSchema !== 'object'
        )
          throw new Error('Invalid plugin tool')
        if (definition.configFields)
          validatePluginFields(definition.configFields)
        if (
          definition.defaultCommands &&
          !Array.isArray(definition.defaultCommands)
        )
          throw new Error('Invalid plugin default commands')
      }
      // Tools use dot-separated IDs; reserve them in the same owned registry.
      scope('tool', items)
      deps.registerTools(items.map(tool), config)
    },
    getEditorInputValue: async () =>
      guard(deps.getEditorInputValue, 'editor')(),
    getEditorInputSelectedText: async () =>
      guard(deps.getEditorInputSelectedText, 'editor')(),
    setEditorInputValue: guard(deps.setEditorInputValue, 'editor'),
    replaceEditorInputSelection: guard(
      deps.replaceEditorInputSelection,
      'editor'
    ),
    setEditorInputFocus: guard(deps.setEditorInputFocus, 'editor'),
    toEditor: guard(deps.toEditor, 'editor'),
    t: guard((value, params) => deps.t(key(value), params)),
    toast: guard((value, level) => deps.toast(key(value), level)),
    toastText: guard(deps.toastText),
    log: guard(deps.log),
    getMyConfig: guard(() =>
      clonePluginValue(config())
    ) as PluginContext['getMyConfig'],
    callApiFunction: async (name, args) => {
      const capability =
        name === 'openInBrowserAndClose'
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
      const result = await deps.callApiFunction(name, args)
      check()
      return result
    },
  }
}
