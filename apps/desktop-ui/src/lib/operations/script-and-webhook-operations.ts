import { errorMessage } from '@tyco/shared/value-guards'
import {
  SCRIPT_CANCELLED_ERROR,
  type ScriptActionRequest,
  type ScriptExecutionResult,
  scriptTakesText,
  type WebhookOperationConfig,
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
  scriptOperationConfigOf,
  webhookOperationConfigOf,
} from '../commands/command-config'
import { secretIdFromRef } from '../net/secrets'
import {
  NO_INPUT_SCHEMA,
  TEXT_INPUT_SCHEMA,
  type OperationDefinition,
  type OperationResult,
} from './operation-types'

export interface ScriptAndWebhookOperationDependencies {
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
/** Unique across windows: each has a counter of its own */
const defaultRunId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? `command-run-${crypto.randomUUID()}`
    : `command-run-${Date.now()}-${++runCounter}-${Math.random().toString(36).slice(2)}`

const cancelled: OperationResult = { ok: false, cancelled: true }

/** The text, when the settings of a script or a webhook mention it */
const textSchema = (takesText: boolean) =>
  takesText ? TEXT_INPUT_SCHEMA : NO_INPUT_SCHEMA

const textOf = (input: Record<string, unknown>): string | null =>
  typeof input.text === 'string' ? input.text : null

function createScriptOperation(
  deps: ScriptAndWebhookOperationDependencies
): OperationDefinition {
  return {
    id: 'script',
    labelKey: 'action.script',
    descriptionKey: 'operations.scriptDescription',
    icon: 'mdi:console-line',
    description: 'Runs a shell command of the user',
    inputSchema: TEXT_INPUT_SCHEMA,
    inputSchemaFor: (config) =>
      textSchema(scriptTakesText(scriptOperationConfigOf(config))),
    canLogOutput: true,
    canSelectPlatforms: true,
    run: async (call) => {
      const config = scriptOperationConfigOf(call.config)
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
      if (!deps.executeScriptAction)
        return { ok: false, messageKey: 'toast.scriptFailed' }
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
      let result: ScriptExecutionResult
      try {
        result = await deps.executeScriptAction({
          ...buildScriptRequest(
            call.command.id,
            // the backend runs the saved command and hands it the text and
            // the selection only when that one mentions `{{TEXT}}` and
            // `{{SELECTION}}`: an unsaved edit here must not decide it
            textOf(call.input),
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
function webhookSecretIds(config: WebhookOperationConfig): string[] {
  const ids = Object.values(config.headers ?? {}).flatMap((value) => {
    const id = secretIdFromRef(value)
    return id ? [id] : []
  })
  if (config.isAuthEnabled && config.authSecretId) ids.push(config.authSecretId)
  return ids
}

function createWebhookOperation(
  deps: ScriptAndWebhookOperationDependencies
): OperationDefinition {
  return {
    id: 'webhook',
    labelKey: 'action.webhook',
    descriptionKey: 'operations.webhookDescription',
    icon: 'mdi:webhook',
    description: 'Sends an HTTP request configured by the user',
    inputSchema: TEXT_INPUT_SCHEMA,
    inputSchemaFor: (config) =>
      textSchema(webhookTakesText(webhookOperationConfigOf(config))),
    canLogOutput: true,
    run: async (call) => {
      const config = webhookOperationConfigOf(call.config)
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
        // without a selection `{{SELECTION}}` is empty, as in a script,
        // never sent as it is written
        response = await deps.executeWebhook(
          target,
          text,
          call.signal,
          call.context?.selectionText ?? null
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
        content: webhookResultText(response),
      }
    },
  }
}

/** `script` and `webhook`: the way out for anything without a tool of its own */
export function createScriptAndWebhookOperations(
  deps: ScriptAndWebhookOperationDependencies
): OperationDefinition[] {
  return [createScriptOperation(deps), createWebhookOperation(deps)]
}
