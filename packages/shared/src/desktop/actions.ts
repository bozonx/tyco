import type { UserConfig } from '../user-config'

/** An external call that wants the selection while access to it is off */
export interface AccessRequest {
  jobId: string
  commandName: string
  /** The output is to replace the selection, not only to be returned */
  replace: boolean
}

export type AccessDecision = 'once' | 'always' | 'deny'

export interface EditorTransfer {
  text?: string
  sourceText?: string
}

/** A script action to run; see `execute_script_action` */
export interface ScriptActionRequest {
  name: string
  command: string
  workingDir?: string
  text: string
  /** The output is used: the command is waited for longer */
  captureOutput: boolean
  /** How long the output is waited for, in seconds; absent for the default */
  timeoutSec?: number
  logOutput: boolean
  /** Lets `cancel_script_action` stop the command while it is waited for */
  runId?: string
}

/** The error of a script stopped with `cancel_script_action` */
export const SCRIPT_CANCELLED_ERROR = 'Cancelled'

/** Where a command or a tool is invoked from, also for the action log */
export type CommandRunSource =
  | 'menu'
  | 'toolbar'
  | 'launcher'
  | 'external'
  | 'chat'
  /** A selection run: the output replaces the selection it got */
  | 'selection'

/**
 * The command the command overlay opens with: an external call that needs a
 * text or the result menu
 */
export interface LauncherRequest {
  commandId: string
  jobId?: string
  output?: 'return' | 'configured'
  input?: Record<string, unknown>
  /** The text of the call; without it the selection or the field gives it */
  text?: string
}

/**
 * How a command of a tool gets its input from a text: none, the text as it is,
 * parsed by the tool, or a structured input only the LLM can fill
 */
export type ToolCatalogInput = 'none' | 'text' | 'parsed' | 'structured'

/**
 * A tool of the webview registry as the backend knows it; see
 * `set_tool_catalog`
 */
export interface ToolCatalogEntry {
  id: string
  input: ToolCatalogInput
  available: boolean
  /** Why the tool cannot run now, translated */
  reason?: string
  inputSchema?: Record<string, unknown>
}

/** An external call that runs a command in the background */
export interface CommandRunEvent {
  commandId: string
  jobId?: string
  output?: 'return' | 'configured'
  input?: Record<string, unknown>
  text?: string
  userConfig: UserConfig
}

/**
 * One run of a library command, written to the action log; see
 * `log_command_run`
 */
export interface CommandRunRecord {
  commandId: string
  name: string
  /** Where the command was invoked from */
  source: CommandRunSource
  /** Absent for a command that takes no text */
  text?: string
  success: boolean
  /** Why it failed */
  message?: string
}

export interface ScriptExecutionResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  /** The command did not finish while waited for and keeps running */
  running: boolean
}
