import {
  type CommandConfig,
  SCRIPT_CANCELLED_ERROR,
  type ScriptActionRequest,
  type ScriptExecutionResult,
} from '@tyco/shared'

import {
  buildScriptRequest,
  scriptFailureDetail,
} from '../custom-actions/script-executor'
import {
  type WebhookTarget,
  webhookResultText,
} from '../custom-actions/webhook-executor'
import {
  commandLabel,
  commandTakesText,
  scriptToolConfig,
  webhookToolConfig,
} from './command-config'

export interface CommandRunnerDependencies {
  showToast: (
    message: string,
    type?: 'info' | 'warn' | 'error' | 'success'
  ) => void
  /** A toast with `messageKey` translated and `detail` after it */
  showError?: (messageKey: string, detail?: string) => void
  /** Opens the action menu on `text`, the result of a command on `sourceText` */
  showResultMenu?: (text: string, sourceText: string) => void
  closeWindow?: () => void
  executeScriptAction?: (
    request: ScriptActionRequest
  ) => Promise<ScriptExecutionResult>
  /** Stops the script of the run, see `ScriptActionRequest.runId` */
  cancelScriptAction?: (runId: string) => Promise<unknown>
  /** Resolves with the response body; rejects once `signal` aborts */
  executeWebhook?: (
    target: WebhookTarget,
    text: string | null,
    signal?: AbortSignal
  ) => Promise<string>
  /** A unique id of a script run */
  newRunId?: () => string
}

export interface CommandRunOptions {
  /** Cancels the run: the script is killed, the request is aborted */
  signal?: AbortSignal
}

/** How a run ended; the user has been told already */
export interface CommandRunOutcome {
  success: boolean
  /** The user cancelled it; nothing was reported */
  cancelled?: boolean
  /** Why it failed, for the log */
  message?: string
}

const succeeded: CommandRunOutcome = { success: true }
const failed = (message: string): CommandRunOutcome => ({
  success: false,
  message,
})

const cancelled: CommandRunOutcome = {
  success: false,
  cancelled: true,
  message: 'Cancelled',
}

let runCounter = 0
const defaultRunId = () => `command-run-${Date.now()}-${++runCounter}`

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs the commands of the library and does what each one says with the output:
 * a toast, or the action menu on it
 */
export function createCommandRunner(deps: CommandRunnerDependencies) {
  /** Opens the action menu on the output, or warns that there is none. */
  const showOutput = (output: string, source: string): CommandRunOutcome => {
    const text = output.replace(/[\r\n]+$/, '')
    if (!text.trim()) {
      deps.showToast('toast.actionEmptyOutput', 'warn')
      return failed('Empty output')
    }
    deps.showResultMenu?.(text, source)
    return succeeded
  }

  const runScript = async (
    command: CommandConfig,
    text: string | null,
    signal?: AbortSignal
  ): Promise<CommandRunOutcome> => {
    const config = scriptToolConfig(command)
    if (!config.command.trim()) {
      deps.showToast('toast.scriptEmptyCommand', 'warn')
      return failed('Empty command')
    }
    const showMenu = command.afterRun === 'showMenu'
    const runId = (deps.newRunId ?? defaultRunId)()
    const cancel = () => {
      void deps.cancelScriptAction?.(runId).catch(() => {})
    }
    signal?.addEventListener('abort', cancel, { once: true })
    let result: ScriptExecutionResult | undefined
    try {
      result = await deps.executeScriptAction?.({
        ...buildScriptRequest(commandLabel(command), config, text, {
          captureOutput: showMenu,
          logOutput: command.logOutput,
        }),
        runId,
      })
    } catch (error) {
      if (signal?.aborted) return cancelled
      const message = errorMessage(error)
      if (message === SCRIPT_CANCELLED_ERROR) return cancelled
      deps.showError?.('toast.scriptFailed', message)
      return failed(message)
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
    // finished before the cancellation reached it
    if (signal?.aborted) return cancelled
    if (!result) return failed('No result')
    if (!result.success && !result.running) {
      const message = scriptFailureDetail(result)
      deps.showError?.('toast.scriptFailed', message)
      return failed(message)
    }
    if (showMenu) return showOutput(result.stdout, text ?? '')
    deps.showToast(
      result.running ? 'toast.scriptRunning' : 'toast.scriptSuccess',
      'success'
    )
    deps.closeWindow?.()
    return succeeded
  }

  const runWebhook = async (
    command: CommandConfig,
    text: string | null,
    signal?: AbortSignal
  ): Promise<CommandRunOutcome> => {
    const config = webhookToolConfig(command)
    if (!config.url.trim()) {
      deps.showToast('toast.webhookEmptyUrl', 'warn')
      return failed('Empty URL')
    }
    let response: string | undefined
    try {
      response = await deps.executeWebhook?.(
        {
          ...config,
          id: command.id,
          name: commandLabel(command),
          logOutput: command.logOutput,
        },
        text,
        signal
      )
    } catch (error) {
      if (signal?.aborted) return cancelled
      const message = errorMessage(error)
      deps.showError?.('toast.webhookFailed', message)
      return failed(message)
    }
    if (signal?.aborted) return cancelled
    if (command.afterRun === 'showMenu') {
      return showOutput(webhookResultText(response ?? ''), text ?? '')
    }
    deps.showToast('toast.webhookSuccess', 'success')
    deps.closeWindow?.()
    return succeeded
  }

  /** Runs `command` on `text`; a command that takes no text gets none */
  const run = async (
    command: CommandConfig,
    text: string,
    options: CommandRunOptions = {}
  ): Promise<CommandRunOutcome> => {
    if (!command.enabled) {
      deps.showToast('toast.commandDisabled', 'warn')
      return failed('Disabled')
    }
    const input = commandTakesText(command) ? text : null
    if (options.signal?.aborted) return cancelled
    if (command.toolId === 'script') {
      return runScript(command, input, options.signal)
    }
    if (command.toolId === 'webhook') {
      return runWebhook(command, input, options.signal)
    }
    deps.showError?.('toast.commandUnavailable', commandLabel(command))
    return failed('Unknown tool')
  }

  return { run }
}

export type CommandRunner = ReturnType<typeof createCommandRunner>
