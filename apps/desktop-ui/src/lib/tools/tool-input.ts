import type {
  JsonSchema,
  ParseResult,
  RegisteredTool,
  ToolInputKind,
  ToolParseContext,
} from './tool-types'

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && !value.trim())

/**
 * The settings a call gets: those of the command over the plugin settings; a
 * field the command leaves empty falls back to the plugin
 */
export function toolCallConfig(
  tool: RegisteredTool,
  toolConfig: Record<string, unknown>
): Record<string, unknown> {
  const config = { ...(tool.baseConfig?.() ?? {}) }
  for (const [key, value] of Object.entries(toolConfig)) {
    if (!isEmpty(value) || !(key in config)) config[key] = value
  }
  return config
}

/** The input schema of a command with these settings */
export function toolInputSchema(
  tool: RegisteredTool,
  config: Record<string, unknown>
): JsonSchema {
  return tool.inputSchemaFor?.(config) ?? tool.inputSchema
}

type SchemaShape = 'none' | 'text' | 'structured'

/** Whether the schema takes nothing, the text alone, or something else */
export function schemaShape(schema: JsonSchema): SchemaShape {
  const keys = Object.keys(schema.properties ?? {})
  if (!keys.length) return 'none'
  if (
    keys.length === 1 &&
    keys[0] === 'text' &&
    schema.properties?.text?.type === 'string'
  ) {
    return 'text'
  }
  return 'structured'
}

/**
 * How a command of the tool gets its input from a text, or `null` when it
 * cannot: a structured input that neither the tool nor the LLM parses
 */
export function toolInputKind(
  tool: RegisteredTool,
  config: Record<string, unknown>,
  llmArgumentParsing = false
): ToolInputKind | null {
  const shape = schemaShape(toolInputSchema(tool, config))
  if (shape !== 'structured') return shape
  return tool.parseText || llmArgumentParsing ? 'parsed' : null
}

const typeMatches = (schema: JsonSchema, value: unknown): boolean => {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return (
        Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      )
    default:
      return true
  }
}

/**
 * What is wrong with `input` for `schema`: the required properties, the types
 * of the known ones and their `enum`. Unknown properties pass, as in MCP
 */
export function validateToolInput(
  schema: JsonSchema,
  input: Record<string, unknown>
): string[] {
  const errors: string[] = []
  for (const key of schema.required ?? []) {
    if (input[key] === undefined) errors.push(`Missing \`${key}\``)
  }
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    const value = input[key]
    if (value === undefined) continue
    if (!typeMatches(property, value)) {
      errors.push(`\`${key}\` must be ${property.type ?? 'valid'}`)
    } else if (property.enum && !property.enum.includes(value)) {
      errors.push(`\`${key}\` has a value not allowed`)
    }
  }
  return errors
}

export interface ToolInputRequest {
  tool: RegisteredTool
  config: Record<string, unknown>
  text: string
  llmArgumentParsing?: boolean
  context: Omit<ToolParseContext, 'config'>
}

/**
 * The input for a text from the menu, the overlay or an external call: nothing,
 * `{ text }`, or what the tool or the LLM parses out of it, checked against the
 * schema
 */
export async function resolveToolInput(
  request: ToolInputRequest
): Promise<ParseResult> {
  const { tool, config, text, context } = request
  const schema = toolInputSchema(tool, config)
  const shape = schemaShape(schema)
  if (shape === 'none') return { ok: true, input: {} }
  if (shape === 'text') return { ok: true, input: { text } }

  let parsed: ParseResult
  if (tool.parseText) {
    parsed = await tool.parseText(text, { ...context, config })
  } else if (request.llmArgumentParsing && context.llm) {
    parsed = {
      ok: true,
      input: await context.llm.extract(text, schema, tool.description),
    }
  } else {
    return { ok: false, messageKey: 'toast.commandInputUnsupported' }
  }
  if (!parsed.ok) return parsed
  const errors = validateToolInput(schema, parsed.input)
  return errors.length
    ? {
        ok: false,
        messageKey: 'toast.commandInputInvalid',
        message: errors.join('; '),
      }
    : parsed
}
