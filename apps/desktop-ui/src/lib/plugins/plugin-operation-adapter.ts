import {
  cancelledOperationResult,
  clonePluginValue,
  validateContribution,
  validateOperationConfigPreview,
  validateOperationResult,
  validateOperationSchema,
  validateParseResult,
  validatePluginFields,
  isPluginError,
  PluginError,
  MAX_CONTRIBUTION_BATCH,
  type PluginCapability,
  type OperationDefinition,
} from '@tyco/plugin-sdk'

import type { OperationDefinition as HostOperationDefinition } from '../operations/operation-types'
import type { PluginLifecycle } from './plugin-manager'
import {
  pluginIconName,
  pluginMessageKey,
  scopeConfigFields,
} from './plugin-resources'

/** Validates plugin tools and adapts their calls, cancellation and messages. */
export function createPluginOperationAdapter(
  id: string,
  lifecycle: PluginLifecycle,
  check: (capability?: PluginCapability) => void
) {
  const key = (value: string) => pluginMessageKey(id, value)!
  function tool(definition: OperationDefinition): HostOperationDefinition {
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
      directoryFieldName: lifecycle.capabilities.includes('notes')
        ? (lifecycle.notesDirectoryField ?? 'pathToNotes')
        : undefined,
      previewConfig: definition.previewConfig
        ? async (config) => {
            check()
            const preview = await definition.previewConfig!(
              clonePluginValue(config)
            )
            check()
            validateOperationConfigPreview(preview)
            return {
              ...preview,
              issues: preview.issues?.map((issue) => ({
                ...issue,
                messageKey: key(issue.messageKey),
              })),
            }
          }
        : undefined,
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
          const run = await definition.run({ ...call, signal })
          const result = signal.aborted ? cancelledOperationResult(run) : run
          if (result.cancelled) return result
          validateOperationResult(result)
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
  function validate(items: OperationDefinition[]) {
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
      validateOperationSchema(definition.inputSchema)
      if (
        definition.parseText !== undefined &&
        typeof definition.parseText !== 'function'
      )
        throw new Error('Invalid plugin parser')
      if (
        definition.previewConfig !== undefined &&
        typeof definition.previewConfig !== 'function'
      )
        throw new Error('Invalid plugin settings preview')
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
