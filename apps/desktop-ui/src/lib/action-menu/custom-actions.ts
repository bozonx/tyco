import type { FetchFunction } from '@bozonx/ai-kit'
import type {
  ScriptExecutionResult,
  ScriptMainAction,
  WebhookMainAction,
} from '@tyco/shared'

import type { ActionItem, ActionMenuDependencies } from './action-menu-store'

export async function executeWebhookAction(
  action: WebhookMainAction,
  text: string,
  fetchFn: FetchFunction,
  logFn?: (name: string, type: string, details: string) => Promise<void>
): Promise<void> {
  const method = action.method || 'POST'
  let url = action.url
  let bodyStr: string | undefined

  if (method === 'GET') {
    try {
      const parsed = new URL(url)
      parsed.searchParams.set('text', text)
      url = parsed.toString()
    } catch {
      const sep = url.includes('?') ? '&' : '?'
      url = `${url}${sep}text=${encodeURIComponent(text)}`
    }
  } else {
    if (action.payloadTemplate?.trim()) {
      bodyStr = action.payloadTemplate.replaceAll('{text}', text)
    } else {
      bodyStr = JSON.stringify({
        text,
        action: action.name || action.id,
        timestamp: Date.now(),
        source: 'tyco',
      })
    }
  }

  const headers: Record<string, string> = {
    'user-agent': 'Tyco-Desktop',
    ...action.headers,
  }

  if (method === 'POST') {
    headers['content-type'] = 'application/json; charset=utf-8'
  }

  try {
    const response = await fetchFn(url, { method, headers, body: bodyStr })
    const responseText =
      typeof response.text === 'function' ? await response.text() : ''

    if (!response.ok) {
      if (action.logOutput && logFn) {
        await logFn(
          action.name || 'Webhook',
          'webhook',
          `URL: ${url}\nMethod: ${method}\nStatus: ${response.status} ${response.statusText}\nResponse:\n${responseText}`
        )
      }
      throw new Error(
        `Webhook failed with status ${response.status}: ${response.statusText}`
      )
    }

    if (action.logOutput && logFn) {
      await logFn(
        action.name || 'Webhook',
        'webhook',
        `URL: ${url}\nMethod: ${method}\nStatus: ${response.status} OK\nResponse:\n${responseText}`
      )
    }
  } catch (error) {
    if (
      action.logOutput &&
      logFn &&
      !(
        error instanceof Error &&
        error.message.startsWith('Webhook failed with status')
      )
    ) {
      await logFn(
        action.name || 'Webhook',
        'webhook',
        `URL: ${url}\nMethod: ${method}\nError: ${String(error)}`
      )
    }
    throw error
  }
}

export function createScriptActionItem(
  item: ScriptMainAction,
  deps: ActionMenuDependencies
): ActionItem {
  const isScript = item.executionType === 'script'
  return {
    id: `script:${item.id}`,
    name: item.name || (isScript ? 'Script' : item.command || 'Command'),
    icon: isScript ? 'mdi:script-text-outline' : 'mdi:console-line',
    action: async (text: string) => {
      await deps.saveOutput(text)
      if (!item.command.trim()) {
        deps.showToast('toast.scriptEmptyCommand', 'warn')
        return
      }
      try {
        const result: ScriptExecutionResult | undefined =
          await deps.executeScriptAction?.(
            item.name || (isScript ? 'Script' : 'Command'),
            item.command,
            text,
            item.logOutput,
            item.executionType,
            item.args,
            item.workingDir
          )
        if (result && !result.success) {
          deps.showToast('toast.scriptFailed', 'error')
        } else {
          deps.showToast('toast.scriptSuccess', 'success')
        }
      } catch {
        deps.showToast('toast.scriptFailed', 'error')
      }
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
      try {
        await deps.executeWebhookAction?.(item, text)
        deps.showToast('toast.webhookSuccess', 'success')
      } catch {
        deps.showToast('toast.webhookFailed', 'error')
      }
      deps.closeWindow?.()
    },
  }
}
