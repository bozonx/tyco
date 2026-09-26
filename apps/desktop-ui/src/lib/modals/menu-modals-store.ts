import { computed, ref } from 'vue'

export enum MenuModals {
  INSERT = 'insert',
  AI_TASK = 'ai-task',
  DIFF = 'diff',
  VOICE_RECOGNITION = 'voice-recognition',
  TRANSLATE = 'translate',
  PREVIEW = 'preview',
  ACTION_SELECT = 'action-select',
  NONE = 'none',
}

export interface MenuModalsDependencies {
  resetGlobalFocus?: () => void
}

/**
 * One screen of the menu stack. Its params may hold `onLeave`, called once the
 * step is removed from the stack, to stop work started for it
 */
export interface MenuStep {
  id: number
  modal: MenuModals
  params: Record<string, any>
}

export function createMenuModalsStoreModel(deps: MenuModalsDependencies = {}) {
  const pendingModal = ref<Record<string, any> | null>(null)
  const steps = ref<MenuStep[]>([])
  let lastStepId = 0

  const topStep = computed(() => steps.value[steps.value.length - 1])
  const currentModal = computed(() => topStep.value?.modal ?? MenuModals.NONE)
  const currentModalParams = computed(() => topStep.value?.params ?? {})
  const currentStepId = computed(() => topStep.value?.id)
  const menuBreadcrumbs = computed(() => steps.value.map((step) => step.modal))

  const leave = (step: MenuStep | undefined) => {
    const onLeave = step?.params.onLeave
    if (typeof onLeave === 'function') onLeave()
  }

  /** Opens a step on top of the stack; returns its id. */
  const nextModal = (
    modal: MenuModals,
    params: Record<string, any> = {}
  ): number => {
    deps.resetGlobalFocus?.()
    const id = ++lastStepId
    steps.value = [...steps.value, { id, modal, params }]
    pendingModal.value = null
    return id
  }

  const back = () => {
    const removed = topStep.value
    steps.value = steps.value.slice(0, -1)
    pendingModal.value = null
    leave(removed)
  }

  const closeAll = () => {
    const removed = [...steps.value].reverse()
    steps.value = []
    pendingModal.value = null
    removed.forEach(leave)
  }

  const setPendingModal = (params: Record<string, any>) => {
    pendingModal.value = params
  }

  const clearPendingModal = () => {
    pendingModal.value = null
  }

  /** Aborts the operation in progress, if it can be cancelled. */
  const cancelPending = () => {
    const onCancel = pendingModal.value?.onCancel
    pendingModal.value = null
    if (typeof onCancel === 'function') onCancel()
  }

  /** Changes the params of a step; false when it is no longer on the stack. */
  const updateStep = (id: number, params: Record<string, any>): boolean => {
    const index = steps.value.findIndex((step) => step.id === id)
    if (index === -1) return false
    const step = steps.value[index]
    const next = [...steps.value]
    next[index] = { ...step, params: { ...step.params, ...params } }
    steps.value = next
    return true
  }

  const hasStep = (id: number): boolean =>
    steps.value.some((step) => step.id === id)

  const anyModalOpen = computed(() => {
    return currentModal.value !== MenuModals.NONE
  })

  return {
    pendingModal,
    currentModal,
    currentModalParams,
    currentStepId,
    menuBreadcrumbs,
    nextModal,
    back,
    closeAll,
    setPendingModal,
    clearPendingModal,
    cancelPending,
    updateStep,
    hasStep,
    anyModalOpen,
  }
}
