import { errorMessage } from '@tyco/shared/value-guards'
import type { FetchFunction } from '@bozonx/ai-kit'
import { ACTION_TEXT_PLACEHOLDER, type WebhookToolConfig } from '@tyco/shared'

import { secretRef } from '../net/secrets'

const WEBHOOK_TIMEOUT_MS = 30_000
const MAX_LOG_RESPONSE_CHARS = 4096

/** Writes a webhook call of the command `name` to the action log */
export type WebhookCallLog = (name: string, details: string) => Promise<void>

/** A webhook to call: the settings of the tool and who calls it */
export interface WebhookTarget extends WebhookToolConfig {
  /** The id of the command; the Authorization secret is kept under it */
  id: string
  name: string
  isOutputLogged?: boolean
}

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

/**
 * The request for `text`; the text goes only where `{{TEXT}}` stands, and
 * `null` is a call without text
 */
export function buildWebhookRequest(
  target: WebhookTarget,
  text: string | null
): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const method = target.method || 'POST'
  let url = target.url.trim()

  if (url.includes(ACTION_TEXT_PLACEHOLDER)) {
    url = url
      .split(ACTION_TEXT_PLACEHOLDER)
      .join(encodeURIComponent(text ?? ''))
  }

  const headers: Record<string, string> = { 'user-agent': 'Tyco-Desktop' }
  let body: string | undefined
  if (method === 'POST') {
    body = target.payloadTemplate?.trim()
      ? isJson(fillJsonTemplate(target.payloadTemplate, ''))
        ? fillJsonTemplate(target.payloadTemplate, text ?? '')
        : target.payloadTemplate.split(ACTION_TEXT_PLACEHOLDER).join(text ?? '')
      : JSON.stringify({
          action: target.name || target.id,
          timestamp: Date.now(),
          source: 'tyco',
        })
    headers['content-type'] = isJson(body)
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8'
  }

  for (const [name, value] of Object.entries(target.headers ?? {})) {
    if (name.trim()) headers[name.trim().toLowerCase()] = value
  }
  if (target.isAuthEnabled) {
    if (!target.authSecretId)
      throw new Error('Missing webhook authorization secret id')
    headers.authorization = secretRef(target.authSecretId)
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
export async function executeWebhook(
  target: WebhookTarget,
  text: string | null,
  fetchFn: FetchFunction,
  logFn?: WebhookCallLog,
  signal?: AbortSignal
): Promise<string> {
  const { url, init } = buildWebhookRequest(target, text)
  // Paths and query strings can contain webhook credentials.
  let origin = '[invalid URL]'
  try {
    origin = new URL(url).origin
  } catch {
    // Invalid URLs are rejected by the transport.
  }
  const logPrefix = `Origin: ${origin}\nMethod: ${init.method}`
  // failures are logged always, like those of commands
  const log = async (details: string, failed: boolean) => {
    if (target.isOutputLogged || failed) {
      try {
        await logFn?.(target.name || 'Webhook', details)
      } catch {
        // Logging must never change the outcome of an external action.
      }
    }
  }

  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
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
    const message = errorMessage(error)
    await log(`${logPrefix}\nError: Request failed or was cancelled`, true)
    throw new Error(message, { cause: error })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }

  const loggedResponse = target.isOutputLogged
    ? `\nResponse:\n${responseText.slice(0, MAX_LOG_RESPONSE_CHARS)}${
        responseText.length > MAX_LOG_RESPONSE_CHARS ? '\n[truncated]' : ''
      }`
    : ''
  await log(
    `${logPrefix}\nStatus: ${response.status}${loggedResponse}`,
    !response.ok
  )
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    )
  }
  return responseText
}
