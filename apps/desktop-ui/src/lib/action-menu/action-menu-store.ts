import { shallowRef } from 'vue'

import type { MainActionConfig, StandardActionId } from '@tyco/shared'

export interface ActionItem {
  id?: StandardActionId
  name?: string
  labelKey?: string
  icon?: string
  disabled?: boolean
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

  const getActionsMenu = () => {
    const defaultActions = getDefaultActions()
    const actionsById = new Map(
      defaultActions.map((action) => [action.id, action] as const)
    )
    const configuredActions = deps.mainActions?.()
    const standardActions = configuredActions
      ? configuredActions.flatMap((item) => {
          if (!item || item.type !== 'standard') return []
          const action = actionsById.get(item.actionId)
          return action ? [action] : []
        })
      : defaultActions

    return [...standardActions, ...registeredActionsMenu.value]
  }

  const getShortcutActions = (): (ActionItem | undefined)[] => {
    const configuredActions = deps.mainActions?.()
    if (!configuredActions) return getActionsMenu()

    const actionsById = new Map(
      getDefaultActions().map((action) => [action.id, action] as const)
    )
    const slots = configuredActions.map((item) =>
      item?.type === 'standard' ? actionsById.get(item.actionId) : undefined
    )
    let lastConfiguredIndex = -1
    slots.forEach((action, index) => {
      if (action) lastConfiguredIndex = index
    })

    return [
      ...slots.slice(0, lastConfiguredIndex + 1),
      ...registeredActionsMenu.value,
    ]
  }

  const registerActionsItems = (actions: ActionItem[]) => {
    registeredActionsMenu.value.push(...actions)
  }

  const clearRegisteredActions = () => {
    registeredActionsMenu.value = []
  }

  return {
    getDefaultActions,
    getActionsMenu,
    getShortcutActions,
    registerActionsItems,
    clearRegisteredActions,
  }
}
