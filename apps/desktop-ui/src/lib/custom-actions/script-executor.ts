import type {
  ScriptActionRequest,
  ScriptExecutionResult,
  ScriptToolConfig,
} from '@tyco/shared'

const MAX_ERROR_DETAIL_LENGTH = 200

/**
 * The request the backend runs; a call without text passes an empty one: the
 * backend substitutes `{{TEXT}}` and fills `TYCO_TEXT` and stdin with it
 */
export function buildScriptRequest(
  name: string,
  config: Pick<ScriptToolConfig, 'command' | 'workingDir'>,
  text: string | null,
  options: { captureOutput: boolean; logOutput: boolean }
): ScriptActionRequest {
  return {
    name,
    command: config.command,
    workingDir: config.workingDir?.trim() || undefined,
    text: text ?? '',
    captureOutput: options.captureOutput,
    logOutput: options.logOutput,
  }
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
