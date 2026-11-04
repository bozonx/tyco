import { errorMessage } from '@tyco/shared/value-guards'
import type { FetchFunction } from '@bozonx/ai-kit'
import {
  ACTION_TEXT_PLACEHOLDER,
  ACTION_SELECTION_PLACEHOLDER,
  substituteVariables,
  type VariablePlace,
  type VariableValues,
  type WebhookToolConfig,
} from '@tyco/shared'

import { isSecretRef, secretRef } from '../net/secrets'

const MAX_LOG_RESPONSE_CHARS = 4096
/** How much of an error response the failure message quotes */
const MAX_ERROR_BODY_CHARS = 200

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
 * `template` filled for `place`; a variable without a value here stops the
 * request, see `substituteVariables`
 */
function filled(
  template: string,
  variables: VariableValues,
  place: VariablePlace,
  text: string | null,
  selectionText?: string | null
): string {
  const result = substituteVariables(
    template,
    variables,
    place,
    text,
    selectionText
  )
  if (result.ok) return result.value
  throw new Error(
    result.missing.length
      ? `Variables not set on this device: ${result.missing.join(', ')}`
      : `The value of the variable ${(result as { invalidName: string }).invalidName} cannot go into a header`
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
  text: string | null,
  variables: VariableValues = {},
  selectionText?: string | null
): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const method = target.method || 'POST'
  const url = filled(target.url.trim(), variables, 'url', text, selectionText)

  const headers: Record<string, string> = { 'user-agent': 'Tyco-Desktop' }
  let body: string | undefined
  if (method === 'POST') {
    const rawTemplate = target.payloadTemplate ?? ''
    const template = rawTemplate.trim()
    body = !template
      ? JSON.stringify({
          action: target.name || target.id,
          timestamp: Date.now(),
          source: 'tyco',
        })
      : filled(rawTemplate, variables, 'json', text, selectionText)
    headers['content-type'] =
      template !== ACTION_TEXT_PLACEHOLDER &&
      template !== ACTION_SELECTION_PLACEHOLDER &&
      isJson(body)
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8'
  }

  for (const [name, value] of Object.entries(target.headers ?? {})) {
    if (!name.trim()) continue
    // a key reference is filled by the proxy, never with a variable
    headers[name.trim().toLowerCase()] = isSecretRef(value)
      ? value
      : filled(value, variables, 'header', null)
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

/**
 * `text` with every URL cut down to its origin: a path or a query may hold
 * credentials or the text itself
 */
function redactUrls(text: string): string {
  return text.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s'"<>]+/gi, (match) => {
    try {
      return new URL(match).origin
    } catch {
      return '[URL]'
    }
  })
}

/** The start of an error response on one line, for the failure message */
function errorBodyExcerpt(body: string): string {
  const line = body.replace(/\s+/g, ' ').trim()
  return line.length > MAX_ERROR_BODY_CHARS
    ? `${line.slice(0, MAX_ERROR_BODY_CHARS)}…`
    : line
}

/**
 * Sends the text; resolves with the response body. There is no time limit of
 * its own: the caller shows the run and cancels it through `signal`, a
 * background caller on its own limit
 */
export async function executeWebhook(
  target: WebhookTarget,
  text: string | null,
  fetchFn: FetchFunction,
  logFn?: WebhookCallLog,
  signal?: AbortSignal,
  variables: VariableValues = {},
  selectionText?: string | null
): Promise<string> {
  const { url, init } = buildWebhookRequest(
    target,
    text,
    variables,
    selectionText
  )
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

  let response: Response
  let responseText: string
  try {
    response = await fetchFn(url, { ...init, signal })
    responseText =
      typeof response.text === 'function' ? await response.text() : ''
  } catch (error) {
    const message = errorMessage(error)
    await log(
      signal?.aborted
        ? `${logPrefix}\nCancelled`
        : `${logPrefix}\nError: ${redactUrls(message)}`,
      true
    )
    // the message goes to toasts and the run log: a URL in it may carry a
    // token in its path or query
    throw new Error(redactUrls(message), { cause: error })
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
    const excerpt = errorBodyExcerpt(responseText)
    throw new Error(
      `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}${excerpt ? `: ${excerpt}` : ''}`
    )
  }
  return responseText
}
