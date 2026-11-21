import type { ScriptActionRequest, ScriptExecutionResult } from '@tyco/shared'

const MAX_ERROR_DETAIL_LENGTH = 200

/**
 * The request the backend runs: it takes the shell command of the saved command
 * `commandId`. A call without text passes an empty one: the backend substitutes
 * `{{TEXT}}` with the quoted and escaped text
 */
export function buildScriptRequest(
  commandId: string,
  text: string | null,
  options: {
    captureOutput: boolean
    isOutputLogged: boolean
    selectionText?: string | null
  }
): ScriptActionRequest {
  return {
    commandId,
    text: text ?? '',
    ...(options.selectionText !== undefined
      ? { selectionText: options.selectionText }
      : {}),
    captureOutput: options.captureOutput,
    logOutput: options.isOutputLogged,
  }
}

/**
 * Asks the backend once to stop the script of `runId`, unless the run is over.
 * A cancel that overtakes the start of the run needs no retry: the backend
 * keeps it and cancels the run as soon as it registers
 */
export function cancelScriptRun(
  cancel: ((runId: string) => Promise<boolean>) | undefined,
  runId: string,
  isOver: () => boolean
): void {
  if (!cancel || isOver()) return
  void cancel(runId).catch(() => false)
}

/** Why a command failed, short enough for a toast */
export function scriptFailureDetail(result: ScriptExecutionResult): string {
  const line = result.stderr
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean)
  const detail =
    line ??
    (result.exitCode === null ? '' : `exit code ${String(result.exitCode)}`)
  return detail.length > MAX_ERROR_DETAIL_LENGTH
    ? `${detail.slice(0, MAX_ERROR_DETAIL_LENGTH)}…`
    : detail
}
