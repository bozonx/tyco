import { isRecord } from '@tyco/shared/value-guards'

import { messages } from '../i18n/messages'
import { toolCallConfig, toolInputSchema } from './tool-input'
import type {
  JsonSchema,
  RegisteredTool,
  ToolCall,
  ToolCommandParameter,
  ToolDefinition,
} from './tool-types'

type Locale = (typeof messages)[keyof typeof messages]

/** A message of the locale by its dotted key, if it is there */
export function localeMessage(locale: Locale, key: string): unknown {
  let value: unknown = locale
  for (const part of key.split('.')) {
    if (!isRecord(value)) return undefined
    value = value[part]
  }
  return value
}

/** Each value of the parameter with its spoken variants in the locale */
export function parameterVariants(
  locale: Locale,
  parameter: ToolCommandParameter
): Record<string, string> {
  const value = localeMessage(locale, parameter.voiceValuesKey)
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

/** The values the parameter can take */
export const parameterValues = (parameter: ToolCommandParameter): string[] =>
  Object.keys(parameterVariants(messages['en-US'], parameter))

const isSet = (value: unknown) =>
  typeof value === 'string' ? Boolean(value.trim()) : value !== undefined

/** The parameters the command leaves to its caller: it has no value for them */
export function openCommandParameters(
  tool: Pick<ToolDefinition, 'commandParameters'> | undefined,
  toolConfig: Record<string, unknown>
): readonly ToolCommandParameter[] {
  return (tool?.commandParameters ?? []).filter(
    (parameter) => !isSet(toolConfig[parameter.name])
  )
}

/** The input schema with the open parameters, which the caller must give */
export function withOpenParameters(
  schema: JsonSchema,
  tool: Pick<ToolDefinition, 'commandParameters'>,
  toolConfig: Record<string, unknown>
): JsonSchema {
  const open = openCommandParameters(tool, toolConfig)
  if (!open.length) return schema
  return {
    ...schema,
    properties: {
      ...schema.properties,
      ...Object.fromEntries(
        open.map((parameter) => [
          parameter.name,
          {
            type: 'string',
            description: parameter.description,
            enum: parameterValues(parameter),
          },
        ])
      ),
    },
    required: [
      ...(schema.required ?? []),
      ...open.map((parameter) => parameter.name),
    ],
  }
}

/** The value of a parameter for the call: the caller's over the command's */
export function parameterValue(call: ToolCall, name: string): string {
  for (const value of [call.input[name], call.config[name]]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * The input a command of the tool takes from a caller that gives it whole: an
 * agent, a chat or an external caller
 */
export function commandInputSchema(
  tool: RegisteredTool,
  toolConfig: Record<string, unknown>
): JsonSchema {
  const config = toolCallConfig(tool, toolConfig)
  return withOpenParameters(toolInputSchema(tool, config), tool, config)
}
