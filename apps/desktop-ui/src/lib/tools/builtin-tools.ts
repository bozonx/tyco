import {
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
  scriptToolConfigOf,
  webhookToolConfigOf,
} from '../commands/command-config'
import {
  NO_INPUT_SCHEMA,
  TEXT_INPUT_SCHEMA,
  type ToolDefinition,
  type ToolResult,
} from './tool-types'

export interface BuiltinToolDependencies {
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

let runCounter = 0
const defaultRunId = () => `command-run-${Date.now()}-${++runCounter}`

const cancelled: ToolResult = { ok: false, cancelled: true }

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The input schema of a script or a webhook: the text, unless it takes none */
const takesTextSchema = (config: Record<string, unknown>) =>
  config.takesText === false ? NO_INPUT_SCHEMA : TEXT_INPUT_SCHEMA

const textOf = (input: Record<string, unknown>): string | null =>
  typeof input.text === 'string' ? input.text : null

export function createScriptTool(
  deps: BuiltinToolDependencies
): ToolDefinition {
  return {
    id: 'script',
    labelKey: 'action.script',
    icon: 'mdi:console-line',
    description: 'Runs a shell command of the user',
    inputSchema: TEXT_INPUT_SCHEMA,
    inputSchemaFor: takesTextSchema,
    run: async (call) => {
      const config = scriptToolConfigOf(call.config)
      if (!config.command.trim()) {
        return {
          ok: false,
          level: 'warn',
          messageKey: 'toast.scriptEmptyCommand',
        }
      }
      const runId = (deps.newRunId ?? defaultRunId)()
      const cancel = () => {
        void deps.cancelScriptAction?.(runId).catch(() => {})
      }
      call.signal.addEventListener('abort', cancel, { once: true })
      let result: ScriptExecutionResult | undefined
      try {
        result = await deps.executeScriptAction?.({
          ...buildScriptRequest(
            call.command?.name || config.command.trim(),
            config,
            config.takesText ? textOf(call.input) : null,
            {
              captureOutput: call.wantsOutput,
              logOutput: call.command?.logOutput ?? false,
            }
          ),
          runId,
        })
      } catch (error) {
        if (call.signal.aborted) return cancelled
        const message = errorMessage(error)
        if (message === SCRIPT_CANCELLED_ERROR) return cancelled
        return { ok: false, messageKey: 'toast.scriptFailed', message }
      } finally {
        call.signal.removeEventListener('abort', cancel)
      }
      // finished before the cancellation reached it
      if (call.signal.aborted) return cancelled
      if (!result) return { ok: false, message: 'No result' }
      if (!result.success && !result.running) {
        return {
          ok: false,
          messageKey: 'toast.scriptFailed',
          message: scriptFailureDetail(result),
        }
      }
      return {
        ok: true,
        messageKey: result.running
          ? 'toast.scriptRunning'
          : 'toast.scriptSuccess',
        content: result.stdout,
      }
    },
  }
}

export function createWebhookTool(
  deps: BuiltinToolDependencies
): ToolDefinition {
  return {
    id: 'webhook',
    labelKey: 'action.webhook',
    icon: 'mdi:webhook',
    description: 'Sends an HTTP request configured by the user',
    inputSchema: TEXT_INPUT_SCHEMA,
    inputSchemaFor: takesTextSchema,
    run: async (call) => {
      const config = webhookToolConfigOf(call.config)
      if (!config.url.trim()) {
        return { ok: false, level: 'warn', messageKey: 'toast.webhookEmptyUrl' }
      }
      let response: string | undefined
      try {
        response = await deps.executeWebhook?.(
          {
            ...config,
            id: call.command?.id ?? '',
            name: call.command?.name || 'Webhook',
            logOutput: call.command?.logOutput ?? false,
          },
          config.takesText ? textOf(call.input) : null,
          call.signal
        )
      } catch (error) {
        if (call.signal.aborted) return cancelled
        return {
          ok: false,
          messageKey: 'toast.webhookFailed',
          message: errorMessage(error),
        }
      }
      if (call.signal.aborted) return cancelled
      return {
        ok: true,
        messageKey: 'toast.webhookSuccess',
        content: webhookResultText(response ?? ''),
      }
    },
  }
}

/** `script` and `webhook`: the way out for anything without a tool of its own */
export function createBuiltinTools(
  deps: BuiltinToolDependencies
): ToolDefinition[] {
  return [createScriptTool(deps), createWebhookTool(deps)]
}
