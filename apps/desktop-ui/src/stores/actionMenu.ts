import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useCallAi } from '../composables/useCallAi'
import { useCallApi } from '../composables/useCallApi'
import useToast from '../composables/useToast'
import { useChatStore } from './chat'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menuModals'

// TODO: почему тут?
export interface ActionItem {
  name?: string
  labelKey?: string
  icon?: string
  disabled?: boolean
  useFullEditorText?: boolean
  preserveWhitespace?: boolean
  action: (text: string) => Promise<void>
}

export const useActionMenuStore = defineStore('actionMenu', () => {
  const { typeIntoWindowAndClose } = useCallApi()
  const ipcStore = useIpcStore()
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
  const appConfig = computed(() => ipcStore.params.appConfig)
  const { correctText } = useCallAi()
  const { toast } = useToast()
  const registeredActionsMenu = ref<ActionItem[]>([])
  const chatStore = useChatStore()

  const getDefaultActions = (): ActionItem[] => [
    {
      labelKey: 'action.insertIntoWindow',
      action: async (text: string) => {
        if (!text?.trim()) {
          toast('toast.textNotSelected', 'error')
          return
        }

        typeIntoWindowAndClose(text)
      },
    },
    {
      labelKey: 'action.copyToClipboard',
      action: async (text: string) => {
        if (!text?.trim()) {
          toast('toast.textNotSelected', 'error')
          return
        }

        await ipcStore.callFunction('putIntoClipboardAndClose', [text])
      },
    },
    {
      labelKey: 'action.aiTask',
      action: async (text: string) => {
        if (!text?.trim()) {
          toast('toast.textNotSelected', 'error')
          return
        }

        menuModalsStore.nextModal(MenuModals.AI_TASK, {
          text,
        })
      },
    },
    {
      labelKey: 'action.correction',
      action: async (text: string) => {
        if (!text?.trim()) {
          toast('toast.textNotSelected', 'error')
          return
        }

        if (text.length < appConfig.value.minCorrectionLength) {
          toast('toast.textTooShortForCorrection', 'warn')
          return
        }

        menuModalsStore.setPendingModal({ correction: true })

        const newText = await correctText(text)

        await historyStore.saveTransformHistory(newText)

        menuModalsStore.clearPendingModal()

        menuModalsStore.nextModal(MenuModals.CORRECTION, {
          oldText: text,
          newText,
        })
      },
    },
    {
      labelKey: 'action.translation',
      action: async (text: string) => {
        if (!text?.trim()) {
          toast('toast.textNotSelected', 'error')
          return
        }

        menuModalsStore.nextModal(MenuModals.TRANSLATE, {
          text,
        })
      },
    },
    {
      labelKey: 'action.askAi',
      useFullEditorText: true,
      preserveWhitespace: true,
      action: async (text: string) => {
        chatStore.startChat({
          initialMessage: text,
        })
      },
    },
    {
      labelKey: 'action.askAiAboutText',
      action: async (text: string) => {
        if (!text?.trim()) {
          toast('toast.textNotSelected', 'error')
          return
        }

        chatStore.startChat({
          attachments: [text],
        })
      },
    },
  ]

  const getActionsMenu = () => {
    return [...getDefaultActions(), ...registeredActionsMenu.value]
  }

  const registerActionsItems = (actions: ActionItem[]) => {
    registeredActionsMenu.value.push(...actions)
  }

  return {
    getDefaultActions,
    getActionsMenu,
    registerActionsItems,
  }
})
