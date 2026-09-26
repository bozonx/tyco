import { shallowRef } from 'vue'

import type { MainActionConfig } from '@tyco/shared'

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
  startCorrection: (text: string) => Promise<void>
  startChatWithAttachment: (text: string) => void
  showToast: (
    message: string,
    type?: 'info' | 'warn' | 'error' | 'success'
  ) => void
  minCorrectionLength?: () => number
  mainActionRegistrations?: () => readonly string[] | undefined
  mainActions?: () => readonly (MainActionConfig | null)[] | undefined
}

export function createActionMenuStoreModel(deps: ActionMenuDependencies) {
  const registeredActionsMenu = shallowRef<ActionItem[]>([])

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
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        const minLength = deps.minCorrectionLength?.() ?? 30
        if (text.length < minLength) {
          deps.showToast('toast.textTooShortForCorrection', 'warn')
          return
        }
        await deps.startCorrection(text)
      },
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
    const slots = resolveMainActions().map((item) =>
      item
        ? (item.type === 'standard' ? defaults : plugins).get(item.actionId)
        : undefined
    )
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
    getActionsMenu,
    getShortcutActions,
    registerActionsItems,
    clearRegisteredActions,
  }
}
