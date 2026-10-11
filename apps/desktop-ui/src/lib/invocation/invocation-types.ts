import type {
  CommandLauncherAfterRun,
  CommandRunSource,
  CustomActionAfterRun,
} from '@tyco/shared'

/**
 * One run of a tool: a command of the library, or a built-in action of the app
 * that needs no saved command
 */
export interface Invocation {
  toolId: string
  /** `toolConfig` of the command, or the settings of a built-in action */
  toolConfig: Record<string, unknown>
  /** The name shown in messages, never empty */
  label: string
  /** The command it comes from; a built-in action has none */
  commandId?: string
  /** Fill a structured input from the text with the LLM */
  llmArgumentParsing?: boolean
  /** The tool writes its output to the action log */
  logOutput?: boolean
  /** Where quick commands send the output, see `resolveSink` */
  launcherSink?: CommandLauncherAfterRun
}

/** What happens to the text a tool returns */
export type ResultSink = CustomActionAfterRun | 'return'

export interface InvocationOptions {
  /** The input as it is, in place of the one parsed from the text */
  input?: Record<string, unknown>
  /** `return` hands the output to the caller whatever the context */
  output?: 'return' | 'configured'
  /** Cancels the run: the script is killed, the request is aborted */
  signal?: AbortSignal
  /** Where the run is invoked from; the action menu by default */
  source?: CommandRunSource
  /** The text came from a selection the output can replace */
  hasSelection?: boolean
  /** The stages of a long run, see `ToolCall.onProgress` */
  onProgress?: (stage: string) => void
}

/** How a run ended; the user has been told already */
export interface InvocationOutcome {
  success: boolean
  output?: string
  code?: string
  /** The user cancelled it; nothing was reported */
  cancelled?: boolean
  /** Why it failed, for the log */
  message?: string
}
