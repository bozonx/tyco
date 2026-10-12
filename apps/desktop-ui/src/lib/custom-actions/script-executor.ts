import type {
  ScriptActionRequest,
  ScriptExecutionResult,
  ScriptToolConfig,
} from '@tyco/shared'

const MAX_ERROR_DETAIL_LENGTH = 200

/**
 * The request the backend runs; a call without text passes an empty one: the
 * backend substitutes `{{TEXT}}` with the quoted and escaped text
 */
export function buildScriptRequest(
  name: string,
  config: Pick<ScriptToolConfig, 'command' | 'workingDir' | 'timeoutSec'>,
  text: string | null,
  options: { captureOutput: boolean; logOutput: boolean }
): ScriptActionRequest {
  return {
    name,
    command: config.command,
    workingDir: config.workingDir?.trim() || undefined,
    text: text ?? '',
    captureOutput: options.captureOutput,
    ...(config.timeoutSec ? { timeoutSec: config.timeoutSec } : {}),
    logOutput: options.logOutput,
  }
}

const CANCEL_RETRY_MS = 100
const CANCEL_ATTEMPTS = 50

/**
 * Asks the backend to stop the script of `runId` until it agrees or the run is
 * over: a cancel that overtakes the start of the run finds nothing to stop
 */
export function cancelScriptRun(
  cancel: ((runId: string) => Promise<boolean>) | undefined,
  runId: string,
  isOver: () => boolean
): void {
  if (!cancel) return
  void (async () => {
    for (let attempt = 0; attempt < CANCEL_ATTEMPTS; attempt += 1) {
      if (isOver()) return
      const stopped = await cancel(runId).catch(() => false)
      if (stopped || isOver()) return
      await new Promise((resolve) => setTimeout(resolve, CANCEL_RETRY_MS))
    }
  })()
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
