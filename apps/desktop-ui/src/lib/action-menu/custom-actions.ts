import type { FetchFunction } from '@bozonx/ai-kit'
import {
  ACTION_TEXT_PLACEHOLDER,
  type ScriptExecutionResult,
  type ScriptMainAction,
  type WebhookMainAction,
  webhookSecretId,
} from '@tyco/shared'

import { secretRef } from '../net/secrets'
import type { ActionItem, ActionMenuDependencies } from './action-menu-store'

export const WEBHOOK_TIMEOUT_MS = 30_000

const MAX_ERROR_DETAIL_LENGTH = 200

export type CustomActionLog = (
  name: string,
  type: string,
  details: string
) => Promise<void>

/**
 * `template` with the text in place of every placeholder: escaped inside a JSON
 * string, `"{{TEXT}}"` included, or as a JSON string of its own when bare.
 */
export function fillJsonTemplate(template: string, text: string): string {
  const quoted = JSON.stringify(text)
  const escaped = quoted.slice(1, -1)
  return template.replace(
    /"((?:[^"\\]|\\.)*)"|\{\{TEXT\}\}/g,
    (match, inner: string | undefined) =>
      inner === undefined
        ? quoted
        : `"${inner.split(ACTION_TEXT_PLACEHOLDER).join(escaped)}"`
  )
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

export function buildWebhookRequest(
  action: WebhookMainAction,
  text: string
): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const method = action.method || 'POST'
  let url = action.url.trim()

  if (url.includes(ACTION_TEXT_PLACEHOLDER)) {
    url = url.split(ACTION_TEXT_PLACEHOLDER).join(encodeURIComponent(text))
  } else if (method === 'GET') {
    try {
      const parsed = new URL(url)
      parsed.searchParams.set('text', text)
      url = parsed.toString()
    } catch {
      const sep = url.includes('?') ? '&' : '?'
      url = `${url}${sep}text=${encodeURIComponent(text)}`
    }
  }

  const headers: Record<string, string> = { 'user-agent': 'Tyco-Desktop' }
  let body: string | undefined
  if (method === 'POST') {
    body = action.payloadTemplate?.trim()
      ? fillJsonTemplate(action.payloadTemplate, text)
      : JSON.stringify({
          text,
          action: action.name || action.id,
          timestamp: Date.now(),
          source: 'tyco',
        })
    headers['content-type'] = isJson(body)
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8'
  }

  for (const [name, value] of Object.entries(action.headers ?? {})) {
    if (name.trim()) headers[name.trim().toLowerCase()] = value
  }
  if (action.authSecret) {
    headers.authorization = secretRef(webhookSecretId(action.id))
  }

  return { url, init: { method, headers, body } }
}

/**
 * The text a webhook answered with: the `text` field of a JSON object, or the
 * body
 */
export function webhookResultText(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { text?: unknown }).text === 'string'
    ) {
      return (parsed as { text: string }).text
    }
  } catch {
    // not JSON
  }
  return body
}

/** Sends the text; resolves with the response body. */
export async function executeWebhookAction(
  action: WebhookMainAction,
  text: string,
  fetchFn: FetchFunction,
  logFn?: CustomActionLog
): Promise<string> {
  const { url, init } = buildWebhookRequest(action, text)
  // the URL is logged as written: the text is the user's, not ours to keep
  const logPrefix = `URL: ${action.url}\nMethod: ${init.method}`
  // failures are logged always, like those of commands
  const log = async (details: string, failed: boolean) => {
    if (action.logOutput || failed) {
      await logFn?.(action.name || 'Webhook', 'webhook', details)
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`No response in ${WEBHOOK_TIMEOUT_MS / 1000} s`)
      ),
    WEBHOOK_TIMEOUT_MS
  )
  let response: Response
  let responseText: string
  try {
    response = await fetchFn(url, { ...init, signal: controller.signal })
    responseText =
      typeof response.text === 'function' ? await response.text() : ''
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await log(`${logPrefix}\nError: ${message}`, true)
    throw new Error(message, { cause: error })
  } finally {
    clearTimeout(timer)
  }

  await log(
    `${logPrefix}\nStatus: ${response.status} ${response.statusText ?? ''}\nResponse:\n${responseText}`,
    !response.ok
  )
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    )
  }
  return responseText
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

/** Opens the action menu on the output, or warns that there is none. */
function showOutput(
  output: string,
  source: string,
  deps: ActionMenuDependencies
): void {
  const text = output.replace(/[\r\n]+$/, '')
  if (!text.trim()) {
    deps.showToast('toast.actionEmptyOutput', 'warn')
    return
  }
  deps.showResultMenu?.(text, source)
}

export function createScriptActionItem(
  item: ScriptMainAction,
  deps: ActionMenuDependencies
): ActionItem {
  const name = item.name || item.command || 'Command'
  return {
    id: `script:${item.id}`,
    name,
    icon: 'mdi:console-line',
    action: async (text: string) => {
      await deps.saveOutput(text)
      if (!item.command.trim()) {
        deps.showToast('toast.scriptEmptyCommand', 'warn')
        return
      }
      const showMenu = item.afterRun === 'showMenu'
      let result: ScriptExecutionResult | undefined
      try {
        result = await deps.executeScriptAction?.({
          name,
          command: item.command,
          workingDir: item.workingDir?.trim() || undefined,
          text,
          captureOutput: showMenu,
          logOutput: Boolean(item.logOutput),
        })
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
        showOutput(result.stdout, text, deps)
        return
      }
      deps.showToast(
        result.running ? 'toast.scriptRunning' : 'toast.scriptSuccess',
        'success'
      )
      deps.closeWindow?.()
    },
  }
}

export function createWebhookActionItem(
  item: WebhookMainAction,
  deps: ActionMenuDependencies
): ActionItem {
  return {
    id: `webhook:${item.id}`,
    name: item.name || 'Webhook',
    icon: 'mdi:webhook',
    action: async (text: string) => {
      await deps.saveOutput(text)
      if (!item.url.trim()) {
        deps.showToast('toast.webhookEmptyUrl', 'warn')
        return
      }
      let response: string | undefined
      try {
        response = await deps.executeWebhookAction?.(item, text)
      } catch (error) {
        deps.showError?.('toast.webhookFailed', errorMessage(error))
        return
      }
      if (item.afterRun === 'showMenu') {
        showOutput(webhookResultText(response ?? ''), text, deps)
        return
      }
      deps.showToast('toast.webhookSuccess', 'success')
      deps.closeWindow?.()
    },
  }
}
