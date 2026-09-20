import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useHelpers } from '../composables/useHelpers'

export enum MenuModals {
  INSERT = 'insert',
  AI_TASK = 'ai-task',
  CORRECTION = 'correction',
  DIFF = 'diff',
  VOICE_RECOGNITION = 'voice-recognition',
  TRANSLATE = 'translate',
  PREVIEW = 'preview',
  ACTION_SELECT = 'action-select',
  NONE = 'none',
}

export const useMenuModalsStore = defineStore('menuModals', () => {
  const pendingModal = ref<Record<string, any> | null>(null)
  const currentModal = ref<MenuModals>(MenuModals.NONE)
  const currentModalParams = ref<Record<string, any>>({})
  const menuBreadcrumbs = ref<MenuModals[]>([])
  const { resetGlobalFocus } = useHelpers()

  const nextModal = (modal: MenuModals, params: Record<string, any>) => {
    resetGlobalFocus()
    menuBreadcrumbs.value.push(modal)

    currentModal.value = modal
    currentModalParams.value = params
    pendingModal.value = null
  }

  const back = () => {
    menuBreadcrumbs.value.pop()

    if (menuBreadcrumbs.value.length > 0) {
      currentModal.value = menuBreadcrumbs.value[
        menuBreadcrumbs.value.length - 1
      ] as MenuModals
      pendingModal.value = null
    } else {
      closeAll()
    }
  }

  const closeAll = () => {
    currentModal.value = MenuModals.NONE
    currentModalParams.value = {}
    menuBreadcrumbs.value = []
    pendingModal.value = null
  }

  const setPendingModal = (params: Record<string, any>) => {
    pendingModal.value = params
  }

  const clearPendingModal = () => {
    pendingModal.value = null
  }

  const anyModalOpen = computed(() => {
    return currentModal.value !== MenuModals.NONE
  })

  return {
    pendingModal,
    currentModal,
    currentModalParams,
    menuBreadcrumbs,
    nextModal,
    back,
    closeAll,
    setPendingModal,
    clearPendingModal,
    anyModalOpen,
  }
})
