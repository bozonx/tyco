import { errorMessage } from '@tyco/shared/value-guards'
import {
  SCRIPT_CANCELLED_ERROR,
  type ScriptActionRequest,
  type ScriptExecutionResult,
  scriptTakesText,
  type WebhookToolConfig,
  webhookTakesText,
} from '@tyco/shared'

import {
  buildScriptRequest,
  cancelScriptRun,
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
import { secretIdFromRef } from '../net/secrets'
import {
  NO_INPUT_SCHEMA,
  TEXT_INPUT_SCHEMA,
  type ToolDefinition,
  type ToolResult,
} from './tool-types'

export interface ScriptAndWebhookToolDependencies {
  executeScriptAction?: (
    request: ScriptActionRequest
  ) => Promise<ScriptExecutionResult>
  /**
   * Stops the script of the run, see `ScriptActionRequest.runId`; false when no
   * such run is going
   */
  cancelScriptAction?: (runId: string) => Promise<boolean>
  /**
   * The ids of the keys this device has values for; a webhook referring to
   * another one is not sent
   */
  secretIds?: () => Promise<ReadonlySet<string>>
  /** Resolves with the response body; rejects once `signal` aborts */
  executeWebhook?: (
    target: WebhookTarget,
    text: string | null,
    signal?: AbortSignal,
    selectionText?: string | null
  ) => Promise<string>
  /** A unique id of a script run */
  newRunId?: () => string
}

let runCounter = 0
const defaultRunId = () => `command-run-${Date.now()}-${++runCounter}`

const cancelled: ToolResult = { ok: false, cancelled: true }

/** The text, when the settings of a script or a webhook mention it */
const textSchema = (takesText: boolean) =>
  takesText ? TEXT_INPUT_SCHEMA : NO_INPUT_SCHEMA

const textOf = (input: Record<string, unknown>): string | null =>
  typeof input.text === 'string' ? input.text : null

function createScriptTool(
  deps: ScriptAndWebhookToolDependencies
): ToolDefinition {
  return {
    id: 'script',
    labelKey: 'action.script',
    descriptionKey: 'tools.scriptDescription',
    icon: 'mdi:console-line',
    description: 'Runs a shell command of the user',
    inputSchema: TEXT_INPUT_SCHEMA,
    inputSchemaFor: (config) =>
      textSchema(scriptTakesText(scriptToolConfigOf(config))),
    canLogOutput: true,
    run: async (call) => {
      const config = scriptToolConfigOf(call.config)
      if (!config.command.trim()) {
        return {
          ok: false,
          level: 'warn',
          messageKey: 'toast.scriptEmptyCommand',
        }
      }
      // the backend runs saved commands only, see `ScriptActionRequest`
      if (!call.command) {
        return { ok: false, messageKey: 'toast.scriptNotSaved' }
      }
      const runId = (deps.newRunId ?? defaultRunId)()
      let isExecutionFinished = false
      const cancel = () => {
        cancelScriptRun(
          deps.cancelScriptAction,
          runId,
          () => isExecutionFinished
        )
      }
      call.signal.addEventListener('abort', cancel, { once: true })
      if (!deps.executeScriptAction)
        return { ok: false, messageKey: 'toast.scriptFailed' }
      let result: ScriptExecutionResult
      try {
        result = await deps.executeScriptAction({
          ...buildScriptRequest(
            call.command.id,
            scriptTakesText(config) ? textOf(call.input) : null,
            {
              captureOutput: call.isOutputRequested,
              isOutputLogged: call.command.isOutputLogged,
              selectionText: call.context?.selectionText,
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
        isExecutionFinished = true
        call.signal.removeEventListener('abort', cancel)
      }
      // finished before the cancellation reached it
      if (call.signal.aborted) return cancelled
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

/** The keys a webhook refers to: its authorization and its secret headers */
function webhookSecretIds(config: WebhookToolConfig): string[] {
  const ids = Object.values(config.headers ?? {}).flatMap((value) => {
    const id = secretIdFromRef(value)
    return id ? [id] : []
  })
  if (config.isAuthEnabled && config.authSecretId) ids.push(config.authSecretId)
  return ids
}

function createWebhookTool(
  deps: ScriptAndWebhookToolDependencies
): ToolDefinition {
  return {
    id: 'webhook',
    labelKey: 'action.webhook',
    descriptionKey: 'tools.webhookDescription',
    icon: 'mdi:webhook',
    description: 'Sends an HTTP request configured by the user',
    inputSchema: TEXT_INPUT_SCHEMA,
    inputSchemaFor: (config) =>
      textSchema(webhookTakesText(webhookToolConfigOf(config))),
    canLogOutput: true,
    run: async (call) => {
      const config = webhookToolConfigOf(call.config)
      if (!config.url.trim()) {
        return { ok: false, level: 'warn', messageKey: 'toast.webhookEmptyUrl' }
      }
      // a window without the network client must not pass for a sent request
      if (!deps.executeWebhook)
        return { ok: false, messageKey: 'toast.webhookFailed' }
      // the config is shared by devices, each with its own keys: one not
      // entered here is asked for rather than the request sent without it
      if (deps.secretIds) {
        const known = await deps.secretIds()
        if (webhookSecretIds(config).some((id) => !known.has(id)))
          return {
            ok: false,
            level: 'warn',
            messageKey: 'toast.webhookKeyNotSet',
            message: call.command?.name || 'Webhook',
          }
      }
      let response: string
      try {
        const target = {
          ...config,
          id: call.command?.id ?? '',
          name: call.command?.name || 'Webhook',
          isOutputLogged: call.command?.isOutputLogged ?? false,
        }
        const text = webhookTakesText(config) ? textOf(call.input) : null
        response = await (call.context?.selectionText !== undefined
          ? deps.executeWebhook(
              target,
              text,
              call.signal,
              call.context.selectionText
            )
          : deps.executeWebhook(target, text, call.signal))
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
        content: webhookResultText(response),
      }
    },
  }
}

/** `script` and `webhook`: the way out for anything without a tool of its own */
export function createScriptAndWebhookTools(
  deps: ScriptAndWebhookToolDependencies
): ToolDefinition[] {
  return [createScriptTool(deps), createWebhookTool(deps)]
}
