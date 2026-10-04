import { shallowRef } from 'vue'

import type {
  MainActionConfig,
  ScriptExecutionResult,
  WebhookMainAction,
} from '@tyco/shared'

import {
  createScriptActionItem,
  createWebhookActionItem,
} from './custom-actions'
import { assignPluginActions } from './main-actions'

export interface ActionItem {
  id?: string
  preferredKey?: string
  name?: string
  labelKey?: string
  icon?: string
  disabled?: boolean
  /** Why the action is disabled, shown on hover */
  hint?: string
  useFullEditorText?: boolean
  preserveWhitespace?: boolean
  action: (text: string) => Promise<void>
}

export interface ActionMenuDependencies {
  typeIntoWindowAndClose: (text: string) => void
  putIntoClipboardAndClose: (text: string) => Promise<void>
  /** Records a text that leaves the app; runs before the window closes. */
  saveOutput: (text: string) => Promise<void>
  openAiTaskModal: (text: string) => void
  openTranslateModal: (text: string) => void
  /** `extra` goes to the params of the correction step, see `InsertMenu` */
  startCorrection: (
    text: string,
    extra?: Record<string, unknown>
  ) => Promise<void>
  startChatWithAttachment: (text: string) => void
  showToast: (
    message: string,
    type?: 'info' | 'warn' | 'error' | 'success'
  ) => void
  minCorrectionLength?: () => number
  mainActionRegistrations?: () => readonly string[] | undefined
  mainActions?: () => readonly (MainActionConfig | null)[] | undefined
  closeWindow?: () => void
  executeScriptAction?: (
    name: string,
    command: string,
    text: string,
    logOutput?: boolean,
    executionType?: 'command' | 'script',
    args?: string,
    workingDir?: string
  ) => Promise<ScriptExecutionResult>
  logCustomAction?: (
    name: string,
    actionType: string,
    details: string
  ) => Promise<void>
  executeWebhookAction?: (
    action: WebhookMainAction,
    text: string
  ) => Promise<void>
}

export function createActionMenuStoreModel(deps: ActionMenuDependencies) {
  const registeredActionsMenu = shallowRef<ActionItem[]>([])

  /** Corrects `text` on a step of its own, unless it is empty or too short. */
  const correct = async (
    text: string,
    extra?: Record<string, unknown>
  ): Promise<void> => {
    if (!text?.trim()) {
      deps.showToast('toast.textNotSelected', 'error')
      return
    }
    const minLength = deps.minCorrectionLength?.() ?? 30
    if (text.length < minLength) {
      deps.showToast('toast.textTooShortForCorrection', 'warn')
      return
    }
    await deps.startCorrection(text, extra)
  }

  const getDefaultActions = (): ActionItem[] => [
    {
      id: 'insertIntoWindow',
      labelKey: 'action.insertIntoWindow',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        await deps.saveOutput(text)
        deps.typeIntoWindowAndClose(text)
      },
    },
    {
      id: 'copyToClipboard',
      labelKey: 'action.copyToClipboard',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        await deps.saveOutput(text)
        await deps.putIntoClipboardAndClose(text)
      },
    },
    {
      id: 'aiTask',
      labelKey: 'action.aiTask',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        deps.openAiTaskModal(text)
      },
    },
    {
      id: 'correction',
      labelKey: 'action.correction',
      action: (text: string) => correct(text),
    },
    {
      id: 'translation',
      labelKey: 'action.translation',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        deps.openTranslateModal(text)
      },
    },
    {
      id: 'askInChat',
      labelKey: 'action.askInChat',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        deps.startChatWithAttachment(text)
      },
    },
  ]

  const getRegisteredActions = () => registeredActionsMenu.value

  const resolveMainActions = (
    config: unknown = deps.mainActions?.(),
    registrations = deps.mainActionRegistrations?.()
  ) => assignPluginActions(config, registeredActionsMenu.value, registrations)

  const getShortcutActions = (): (ActionItem | undefined)[] => {
    const defaults = new Map(
      getDefaultActions().map((action) => [action.id, action])
    )
    const plugins = new Map(
      registeredActionsMenu.value.map((action) => [action.id, action])
    )
    const slots = resolveMainActions().map((item) => {
      if (!item) return undefined
      if (item.type === 'standard') return defaults.get(item.actionId)
      if (item.type === 'plugin') return plugins.get(item.actionId)
      if (item.type === 'script') return createScriptActionItem(item, deps)
      if (item.type === 'webhook') return createWebhookActionItem(item, deps)
      return undefined
    })
    while (slots.length && !slots.at(-1)) slots.pop()
    return [
      ...slots,
      ...registeredActionsMenu.value.filter((action) => !action.id),
    ]
  }

  const getActionsMenu = () =>
    getShortcutActions().filter((action): action is ActionItem => !!action)

  const registerActionsItems = (actions: ActionItem[]) => {
    const next = [...registeredActionsMenu.value]
    for (const action of actions) {
      const index = action.id
        ? next.findIndex((item) => item.id === action.id)
        : -1
      if (index >= 0) next[index] = action
      else next.push(action)
    }
    registeredActionsMenu.value = next
  }

  const clearRegisteredActions = () => {
    registeredActionsMenu.value = []
  }

  return {
    getRegisteredActions,
    resolveMainActions,
    getDefaultActions,
    correct,
    getActionsMenu,
    getShortcutActions,
    registerActionsItems,
    clearRegisteredActions,
  }
}
