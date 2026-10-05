import type {
  CommandConfig,
  CommandRunSource,
  CustomActionAfterRun,
  UserConfig,
} from '@tyco/shared'

import type { InputConfigItem } from '../../types'

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
  logOutput: boolean
}

export interface ToolCall {
  input: Record<string, unknown>
  /** `toolConfig` of the command over the plugin settings */
  config: Record<string, unknown>
  /** Where the call came from */
  source: CommandRunSource
  signal: AbortSignal
  command?: ToolCallCommand
  /** The output is used: it is not enough to start a long script and leave */
  wantsOutput: boolean
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
  /** Text output: handled by `afterRun`, logged, or returned to the agent */
  content?: string
  /** The window stays open after a run without output, e.g. for the editor */
  keepWindow?: boolean
}

export interface DefaultCommandsContext {
  userConfig: UserConfig
  t(key: string, params?: Record<string, unknown>): string
}

/** A preset command of a tool, added to the library once */
export interface DefaultCommand {
  /** Local; the command id becomes `default:<toolId>:<id>` */
  id: string
  /** Already translated; stored as the command name */
  name: string
  phrases?: string[]
  description?: string
  toolConfig?: Record<string, unknown>
  afterRun?: CustomActionAfterRun
  confirm?: CommandConfig['confirm']
  /** Adds a menu item, taking the place of a former plugin action item */
  menu?: { replaces?: string; preferredKey?: string }
}

export interface ToolDefinition {
  /** Local to the plugin; the full id becomes `<pluginName>.<id>` */
  id: string
  labelKey?: string
  label?: string
  icon?: string
  /** Shown to the LLM, in English, like an MCP tool description */
  description: string
  /** JSON Schema of the per-call input, as in MCP */
  inputSchema: JsonSchema
  /**
   * The input schema of a command with these settings, when it depends on them
   * (`takesText` of a script or a webhook)
   */
  inputSchemaFor?(config: Record<string, unknown>): JsonSchema
  /**
   * Turns the text from voice, the editor or an external call into an input
   * that matches `inputSchema`; needed only for a structured schema
   */
  parseText?(text: string, context: ToolParseContext): Promise<ParseResult>
  /** Rendered in the command editor, same format as plugin settings */
  configFields?: InputConfigItem[]
  /** Phrases suggested when the user creates a command for this tool */
  defaultPhrasesKey?: string
  /** Presets added to the library once */
  defaultCommands?(context: DefaultCommandsContext): DefaultCommand[]
  /**
   * Why the tool cannot run now (no LLM configured and so on); its commands are
   * then marked unavailable. Absent means always available
   */
  unavailableReason?(): string | undefined
  run(call: ToolCall): Promise<ToolResult>
}

/** Who provides a tool of the registry */
export type ToolOwner = { kind: 'core' } | { kind: 'plugin'; name: string }

/** A tool of the registry under its full id */
export interface RegisteredTool extends ToolDefinition {
  owner: ToolOwner
  /**
   * The settings a command falls back to for the fields it leaves empty: the
   * settings of the plugin
   */
  baseConfig?(): Record<string, unknown>
}

/** What the commands need from the registry */
export interface ToolLookup {
  get(toolId: string): RegisteredTool | undefined
}
