import {
  MAX_TOOL_SCHEMA_PROPERTIES,
  hasContributionIdFormat,
} from './package-format.js'
import { isRecord } from './value-guards.js'
import type { ToolResult, ParseResult } from './tools.js'

/** Check untrusted registration data before it reaches a host registry. */
export function validateContribution(
  value: unknown,
  kind: 'action' | 'edit' | 'toolbar' | 'tool'
): void {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !hasContributionIdFormat(value.id)
  )
    throw new Error(`Invalid ${kind} ID`)
  for (const field of [
    'name',
    'label',
    'labelKey',
    'icon',
    'tooltip',
    'tooltipKey',
    'hint',
    'preferredKey',
    'description',
    'descriptionKey',
    'defaultPhrasesKey',
  ])
    if (value[field] !== undefined && typeof value[field] !== 'string')
      throw new Error(`Invalid contribution ${field}`)
  for (const field of [
    'disabled',
    'selectionOnly',
    'useFullEditorText',
    'preserveWhitespace',
  ])
    if (value[field] !== undefined && typeof value[field] !== 'boolean')
      throw new Error(`Invalid contribution ${field}`)
  if (
    value.order !== undefined &&
    (typeof value.order !== 'number' || !Number.isFinite(value.order))
  )
    throw new Error('Invalid contribution order')
  if (kind === 'toolbar') {
    if (
      value.position !== undefined &&
      !['left', 'right'].includes(String(value.position))
    )
      throw new Error('Invalid toolbar position')
    if (value.toolId !== undefined) {
      if (
        typeof value.toolId !== 'string' ||
        !hasContributionIdFormat(value.toolId) ||
        value.action !== undefined
      )
        throw new Error('Invalid toolbar tool reference')
      return
    }
  }
  if (kind !== 'tool' && typeof value.action !== 'function')
    throw new Error('Missing plugin callback')
}

export function validateToolResult(
  value: unknown
): asserts value is ToolResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean')
    throw new Error('Invalid plugin tool result')
  for (const field of ['messageKey', 'message', 'content'])
    if (value[field] !== undefined && typeof value[field] !== 'string')
      throw new Error(`Invalid tool result ${field}`)
  for (const field of ['cancelled', 'keepWindow'])
    if (value[field] !== undefined && typeof value[field] !== 'boolean')
      throw new Error(`Invalid tool result ${field}`)
  if (
    value.level !== undefined &&
    !['info', 'warn', 'error', 'success'].includes(String(value.level))
  )
    throw new Error('Invalid tool result level')
  if (value.meta !== undefined && !isRecord(value.meta))
    throw new Error('Invalid tool result metadata')
}

export function validateParseResult(
  value: unknown
): asserts value is ParseResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean')
    throw new Error('Invalid plugin parse result')
  if (value.ok && !isRecord(value.input))
    throw new Error('Invalid plugin parsed input')
  for (const field of ['messageKey', 'message', 'summary'])
    if (value[field] !== undefined && typeof value[field] !== 'string')
      throw new Error(`Invalid parse result ${field}`)
}

export function validateToolSchema(value: unknown, depth = 0): void {
  if (!isRecord(value) || depth > 16)
    throw new Error('Invalid tool input schema')
  if (
    value.type !== undefined &&
    !['object', 'string', 'number', 'integer', 'boolean', 'array'].includes(
      String(value.type)
    )
  )
    throw new Error('Invalid tool schema type')
  if (value.properties !== undefined) {
    if (
      !isRecord(value.properties) ||
      Object.keys(value.properties).length > MAX_TOOL_SCHEMA_PROPERTIES
    )
      throw new Error('Invalid tool schema properties')
    for (const schema of Object.values(value.properties))
      validateToolSchema(schema, depth + 1)
  }
  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) ||
      value.required.some((key) => typeof key !== 'string'))
  )
    throw new Error('Invalid tool schema required fields')
  if (value.enum !== undefined && !Array.isArray(value.enum))
    throw new Error('Invalid tool schema enum')
  if (value.items !== undefined) validateToolSchema(value.items, depth + 1)
}
