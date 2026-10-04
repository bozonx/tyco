import type { FetchFunction } from '@bozonx/ai-kit'
import {
  ACTION_TEXT_PLACEHOLDER,
  type WebhookToolConfig,
  webhookSecretId,
} from '@tyco/shared'

import { secretRef } from '../net/secrets'

export const WEBHOOK_TIMEOUT_MS = 30_000

export type CustomActionLog = (
  name: string,
  type: string,
  details: string
) => Promise<void>

/** A webhook to call: the settings of the tool and who calls it */
export interface WebhookTarget extends Omit<WebhookToolConfig, 'takesText'> {
  /** The id of the command; the Authorization secret is kept under it */
  id: string
  name: string
  logOutput?: boolean
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
 * The request for `text`; `null` is a call without text: no `text` parameter or
 * field is added
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
  } else if (method === 'GET' && text !== null) {
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
    body = target.payloadTemplate?.trim()
      ? fillJsonTemplate(target.payloadTemplate, text ?? '')
      : JSON.stringify({
          ...(text === null ? {} : { text }),
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
  if (target.authSecret) {
    headers.authorization = secretRef(webhookSecretId(target.id))
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
  logFn?: CustomActionLog
): Promise<string> {
  const { url, init } = buildWebhookRequest(target, text)
  // the URL is logged as written: the text is the user's, not ours to keep
  const logPrefix = `URL: ${target.url}\nMethod: ${init.method}`
  // failures are logged always, like those of commands
  const log = async (details: string, failed: boolean) => {
    if (target.logOutput || failed) {
      await logFn?.(target.name || 'Webhook', 'webhook', details)
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
