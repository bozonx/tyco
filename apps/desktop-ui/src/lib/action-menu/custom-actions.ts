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
  fetchFn: FetchFunction
): Promise<void> {
  let bodyStr: string
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

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': 'Tyco-Desktop',
    ...action.headers,
  }

  const response = await fetchFn(action.url, {
    method: 'POST',
    headers,
    body: bodyStr,
  })

  if (!response.ok) {
    throw new Error(
      `Webhook failed with status ${response.status}: ${response.statusText}`
    )
  }

  if (action.logOutput) {
    await response.text()
  }
}

export function createScriptActionItem(
  item: ScriptMainAction,
  deps: ActionMenuDependencies
): ActionItem {
  return {
    id: `script:${item.id}`,
    name: item.name || 'Script',
    icon: 'mdi:script-text-outline',
    action: async (text: string) => {
      await deps.saveOutput(text)
      if (!item.command.trim()) {
        deps.showToast('toast.scriptEmptyCommand', 'warn')
        return
      }
      try {
        const result: ScriptExecutionResult | undefined =
          await deps.executeScriptAction?.(
            item.name || 'Script',
            item.command,
            text,
            item.logOutput
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
