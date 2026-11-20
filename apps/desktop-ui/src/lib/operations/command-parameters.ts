import { isRecord } from '@tyco/shared/value-guards'

import { messages } from '../i18n/messages'
import { operationCallConfig, operationInputSchema } from './operation-input'
import type {
  JsonSchema,
  RegisteredOperation,
  OperationCall,
  OperationCommandParameter,
  OperationDefinition,
} from './operation-types'

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
  parameter: OperationCommandParameter
): Record<string, string> {
  if (parameter.voiceValuesKey) {
    const value = localeMessage(locale, parameter.voiceValuesKey)
    if (!isRecord(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  }
  if (!parameter.options?.length) return {}
  const result: Record<string, string> = {}
  for (const opt of parameter.options) {
    const parts: string[] = []
    if (opt.voiceAliases?.length) parts.push(...opt.voiceAliases)
    if (opt.voiceAliasesKey) {
      const msg = localeMessage(locale, opt.voiceAliasesKey)
      if (typeof msg === 'string' && msg.trim()) parts.push(msg)
    }
    if (!parts.length) {
      if (opt.labelKey) {
        const msg = localeMessage(locale, opt.labelKey)
        if (typeof msg === 'string' && msg.trim()) parts.push(msg)
      } else if (opt.label?.trim()) {
        parts.push(opt.label.trim())
      } else {
        parts.push(opt.value)
      }
    }
    result[opt.value] = parts.join(';')
  }
  return result
}

/** The values the parameter can take */
export const parameterValues = (parameter: OperationCommandParameter): string[] =>
  parameter.options?.length
    ? parameter.options.map((opt) => opt.value)
    : Object.keys(parameterVariants(messages['en-US'], parameter))

const isSet = (value: unknown) =>
  typeof value === 'string' ? Boolean(value.trim()) : value !== undefined

/** The parameters the command leaves to its caller: it has no value for them */
export function openCommandParameters(
  tool: Pick<OperationDefinition, 'commandParameters'> | undefined,
  operationConfig: Record<string, unknown>
): readonly OperationCommandParameter[] {
  return (tool?.commandParameters ?? []).filter(
    (parameter) => !isSet(operationConfig[parameter.name])
  )
}

/** The input schema with the open parameters, which the caller must give */
export function withOpenParameters(
  schema: JsonSchema,
  tool: Pick<OperationDefinition, 'commandParameters'>,
  operationConfig: Record<string, unknown>
): JsonSchema {
  const open = openCommandParameters(tool, operationConfig)
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
export function parameterValue(call: OperationCall, name: string): string {
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
  tool: RegisteredOperation,
  operationConfig: Record<string, unknown>
): JsonSchema {
  const config = operationCallConfig(tool, operationConfig)
  return withOpenParameters(operationInputSchema(tool, config), tool, config)
}
