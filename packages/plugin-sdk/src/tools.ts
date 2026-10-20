import type { InputConfigItem } from './config.js'
import type { EditorInputSnapshot } from './plugin.js'

export type CommandRunSource =
  'menu' | 'toolbar' | 'launcher' | 'voice' | 'external' | 'chat' | 'selection'
export type CommandOutputAction =
  'none' | 'showMenu' | 'insertIntoWindow' | 'copyToClipboard'

/**
 * A JSON Schema as MCP tools describe their input; only the parts the app
 * checks are typed
 */
export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
  items?: JsonSchema
  enum?: readonly unknown[]
  description?: string
  [key: string]: unknown
}

/** The input of a tool that takes nothing */
export const NO_INPUT_SCHEMA: JsonSchema = { type: 'object', properties: {} }

/** The input of a tool that takes the text as it is */
export const TEXT_INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
}

/**
 * How a command gets its input from a text: none, the text as it is, or the
 * text parsed by the tool or the LLM
 */
export type ToolInputKind = 'none' | 'text' | 'parsed'

export interface ToolParseContext {
  config: Record<string, unknown>
  /** Dictation language of the text, if known */
  language?: string
  now: Date
  signal: AbortSignal
  /** Absent when no LLM is configured; the parser must then work without it */
  llm?: {
    /** Fills `schema` from `text` with structured output */
    extract(
      text: string,
      schema: JsonSchema,
      instructions?: string
    ): Promise<Record<string, unknown>>
  }
}

export type ParseResult =
  | { ok: true; input: Record<string, unknown>; summary?: string }
  | { ok: false; messageKey?: string; message?: string }

/** The command a tool is called for; absent for a toolbar button */
export interface ToolCallCommand {
  id: string
  name: string
  isOutputLogged: boolean
  /** @deprecated Use isOutputLogged. Supplied for older installed plugins. */
  logOutput?: boolean
}

export interface ToolCall {
  input: Record<string, unknown>
  /** `toolConfig` of the command over the plugin settings */
  config: Record<string, unknown>
  /** Where the call came from */
  source: CommandRunSource
  /** Present when the toolbar captured the input from the editor. */
  editorSnapshot?: EditorInputSnapshot
  signal: AbortSignal
  command?: ToolCallCommand
  /** The output is used: it is not enough to start a long script and leave */
  isOutputRequested: boolean
  /** @deprecated Use isOutputRequested. Supplied for older installed plugins. */
  wantsOutput?: boolean
  /** Tells the caller which stage a long run is at, for it to show */
  onProgress?: (stage: string) => void
}

export interface ToolResult {
  ok: boolean
  /** The user cancelled the call; nothing is reported */
  cancelled?: boolean
  /** The toast kind; `success` or `error` by `ok` when absent */
  level?: 'info' | 'warn' | 'error' | 'success'
  /** Shown in the toast, translated, followed by `message` */
  messageKey?: string
  /** Plain text: the detail after `messageKey`, or the whole message */
  message?: string
  /**
   * Text output: handled by the invocation context, logged, or returned to the
   * caller
   */
  content?: string
  /**
   * Facts about the output for a caller that shows them, e.g. the provider of a
   * translation; the rest ignore them
   */
  meta?: Record<string, unknown>
  /** The window stays open after a run without output, e.g. for the editor */
  keepWindow?: boolean
}

export interface ToolDefinition {
  /** Local to the plugin; the full id becomes `<pluginName>.<id>` */
  id: string
  labelKey?: string
  label?: string
  icon?: string
  /** Shown in the tool picker of a new command */
  descriptionKey?: string
  /** Shown to the LLM, in English, like an MCP tool description */
  description: string
  /** JSON Schema of the per-call input, as in MCP */
  inputSchema: JsonSchema
  /**
   * Turns the text from voice, the editor or an external call into an input
   * that matches `inputSchema`; needed only for a structured schema
   */
  parseText?(text: string, context: ToolParseContext): Promise<ParseResult>
  /** Rendered in the command editor, same format as plugin settings */
  configFields?: InputConfigItem[]
  /**
   * What a new command of the tool does with its output; a tool that turns a
   * text into another one replaces the selection
   */
  defaultOutputAction?: CommandOutputAction
  /** Phrases suggested when the user creates a command for this tool */
  defaultPhrasesKey?: string
  run(call: ToolCall): Promise<ToolResult>
}
