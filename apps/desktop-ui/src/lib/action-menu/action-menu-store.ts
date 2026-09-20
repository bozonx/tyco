import { shallowRef } from 'vue'

export interface ActionItem {
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
  openAiTaskModal: (text: string) => void
  openTranslateModal: (text: string) => void
  startCorrection: (text: string) => Promise<void>
  startChatWithAttachment: (text: string) => void
  showToast: (
    message: string,
    type?: 'info' | 'warn' | 'error' | 'success'
  ) => void
  minCorrectionLength?: () => number
}

export function createActionMenuStoreModel(deps: ActionMenuDependencies) {
  const registeredActionsMenu = shallowRef<ActionItem[]>([])

  const getDefaultActions = (): ActionItem[] => [
    {
      labelKey: 'action.insertIntoWindow',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        deps.typeIntoWindowAndClose(text)
      },
    },
    {
      labelKey: 'action.copyToClipboard',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        await deps.putIntoClipboardAndClose(text)
      },
    },
    {
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
    return [...getDefaultActions(), ...registeredActionsMenu.value]
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
    registerActionsItems,
    clearRegisteredActions,
  }
}
