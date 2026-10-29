import {
  validateContribution,
  validateToolResult,
  validateToolSchema,
  validateParseResult,
  validatePluginFields,
  isPluginError,
  PluginError,
  MAX_CONTRIBUTION_BATCH,
  type PluginCapability,
  type ToolDefinition,
} from '@tyco/plugin-sdk'

import type { ToolDefinition as HostToolDefinition } from '../tools/tool-types'
import type { PluginLifecycle } from './plugin-manager'
import {
  pluginIconName,
  pluginMessageKey,
  scopeConfigFields,
} from './plugin-resources'

/** Validates plugin tools and adapts their calls, cancellation and messages. */
export function createPluginToolAdapter(
  id: string,
  lifecycle: PluginLifecycle,
  check: (capability?: PluginCapability) => void
) {
  const key = (value: string) => pluginMessageKey(id, value)!
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
  function validate(items: ToolDefinition[]) {
    if (!Array.isArray(items) || items.length > MAX_CONTRIBUTION_BATCH)
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
      if (definition.configFields) validatePluginFields(definition.configFields)
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
  }
  return { adapt: tool, validate }
}
