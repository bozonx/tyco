import type {
  CommandConfig,
  ScriptActionRequest,
  ScriptExecutionResult,
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
  /** Resolves with the response body */
  executeWebhook?: (
    target: WebhookTarget,
    text: string | null
  ) => Promise<string>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs the commands of the library and does what each one says with the output:
 * a toast, or the action menu on it
 */
export function createCommandRunner(deps: CommandRunnerDependencies) {
  /** Opens the action menu on the output, or warns that there is none. */
  const showOutput = (output: string, source: string): void => {
    const text = output.replace(/[\r\n]+$/, '')
    if (!text.trim()) {
      deps.showToast('toast.actionEmptyOutput', 'warn')
      return
    }
    deps.showResultMenu?.(text, source)
  }

  const runScript = async (
    command: CommandConfig,
    text: string | null
  ): Promise<void> => {
    const config = scriptToolConfig(command)
    if (!config.command.trim()) {
      deps.showToast('toast.scriptEmptyCommand', 'warn')
      return
    }
    const showMenu = command.afterRun === 'showMenu'
    let result: ScriptExecutionResult | undefined
    try {
      result = await deps.executeScriptAction?.(
        buildScriptRequest(commandLabel(command), config, text, {
          captureOutput: showMenu,
          logOutput: command.logOutput,
        })
      )
    } catch (error) {
      deps.showError?.('toast.scriptFailed', errorMessage(error))
      return
    }
    if (!result) return
    if (!result.success && !result.running) {
      deps.showError?.('toast.scriptFailed', scriptFailureDetail(result))
      return
    }
    if (showMenu) {
      showOutput(result.stdout, text ?? '')
      return
    }
    deps.showToast(
      result.running ? 'toast.scriptRunning' : 'toast.scriptSuccess',
      'success'
    )
    deps.closeWindow?.()
  }

  const runWebhook = async (
    command: CommandConfig,
    text: string | null
  ): Promise<void> => {
    const config = webhookToolConfig(command)
    if (!config.url.trim()) {
      deps.showToast('toast.webhookEmptyUrl', 'warn')
      return
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
        text
      )
    } catch (error) {
      deps.showError?.('toast.webhookFailed', errorMessage(error))
      return
    }
    if (command.afterRun === 'showMenu') {
      showOutput(webhookResultText(response ?? ''), text ?? '')
      return
    }
    deps.showToast('toast.webhookSuccess', 'success')
    deps.closeWindow?.()
  }

  /** Runs `command` on `text`; a command that takes no text gets none */
  const run = async (command: CommandConfig, text: string): Promise<void> => {
    if (!command.enabled) {
      deps.showToast('toast.commandDisabled', 'warn')
      return
    }
    const input = commandTakesText(command) ? text : null
    if (command.toolId === 'script') return runScript(command, input)
    if (command.toolId === 'webhook') return runWebhook(command, input)
    deps.showError?.('toast.commandUnavailable', commandLabel(command))
  }

  return { run }
}

export type CommandRunner = ReturnType<typeof createCommandRunner>
