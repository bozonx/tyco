import { computed, ref } from 'vue'

import {
  MenuModals,
  type BufferedPendingAction,
  type MenuStep,
  type OpenModalArgs,
  type UpdateModalArgs,
  type PendingModalParams,
} from './menu-modal-params'
export { MenuModals } from './menu-modal-params'
export type { BufferedPendingAction, MenuStep } from './menu-modal-params'

export interface MenuModalsDependencies {
  blurActiveElement?: () => void
}

export function createMenuModalsModel(deps: MenuModalsDependencies = {}) {
  const pendingModal = ref<PendingModalParams | null>(null)
  const bufferedIntent = ref<BufferedPendingAction | null>(null)
  const steps = ref<MenuStep[]>([])
  let lastStepId = 0
  let pendingId = 0

  const topStep = computed<MenuStep | undefined>(
    () => steps.value[steps.value.length - 1]
  )
  const currentModal = computed<MenuModals>(
    () => topStep.value?.modal ?? MenuModals.NONE
  )
  const currentModalParams = computed(() => topStep.value?.params ?? {})
  const currentStepId = computed(() => topStep.value?.id)
  const menuBreadcrumbs = computed(() => steps.value.map((step) => step.modal))

  const leave = (step: MenuStep | undefined) => {
    const onLeave = step?.params.onLeave
    if (typeof onLeave === 'function') onLeave()
  }

  /** Opens a step on top of the stack; returns its id. */
  const nextModal = (...request: OpenModalArgs): number => {
    const [modal, params = {}] = request
    deps.blurActiveElement?.()
    const id = ++lastStepId
    // The public tuple contract pairs the modal with its parameters.
    const step = { id, modal, params } as MenuStep
    steps.value = [...steps.value, step]
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
    bufferedIntent.value = null
    removed.forEach(leave)
  }

  const setBufferedIntent = (intent: BufferedPendingAction | null) => {
    bufferedIntent.value = intent
  }

  const clearBufferedIntent = () => {
    bufferedIntent.value = null
  }

  const consumeBufferedIntent = (): BufferedPendingAction | null => {
    const current = bufferedIntent.value
    bufferedIntent.value = null
    return current
  }

  const setPendingModal = (
    params: PendingModalParams,
    owner?: number
  ): number => {
    if (owner !== undefined && (owner !== pendingId || !pendingModal.value)) {
      return owner
    }
    if (owner === undefined) {
      cancelPending()
      // Hidden query inputs must not intercept Escape from the progress UI.
      deps.blurActiveElement?.()
      pendingId += 1
      bufferedIntent.value = null
    }
    pendingModal.value = params
    return pendingId
  }

  const clearPendingModal = (owner?: number) => {
    if (owner !== undefined && owner !== pendingId) return
    pendingModal.value = null
    bufferedIntent.value = null
  }

  /** Aborts the operation in progress, if it can be cancelled. */
  const cancelPending = () => {
    const onCancel = pendingModal.value?.onCancel
    pendingModal.value = null
    bufferedIntent.value = null
    if (typeof onCancel === 'function') onCancel()
  }

  /** Cancels pending work before removing its UI; closeAll alone only hides it. */
  const cancelAndCloseAll = () => {
    cancelPending()
    closeAll()
  }

  /** Changes the params of a step; false when it is no longer on the stack. */
  const updateStep = (...[id, modal, params]: UpdateModalArgs): boolean => {
    const index = steps.value.findIndex((step) => step.id === id)
    if (index === -1) return false
    const step = steps.value[index]
    if (!step || step.modal !== modal) return false
    const next = [...steps.value]
    // Matching discriminators ensure the patch belongs to this step.
    next[index] = { ...step, params: { ...step.params, ...params } } as MenuStep
    steps.value = next
    return true
  }

  const hasStep = (id: number): boolean =>
    steps.value.some((step) => step.id === id)

  const hasOpenModal = computed(() => {
    return currentModal.value !== MenuModals.NONE
  })

  return {
    steps,
    currentStep: topStep,
    pendingModal,
    bufferedIntent: computed(() => bufferedIntent.value),
    setBufferedIntent,
    clearBufferedIntent,
    consumeBufferedIntent,
    currentModal,
    currentModalParams,
    currentStepId,
    menuBreadcrumbs,
    nextModal,
    back,
    closeAll,
    cancelAndCloseAll,
    setPendingModal,
    clearPendingModal,
    isPendingModal: (owner: number) =>
      owner === pendingId && pendingModal.value !== null,
    cancelPending,
    updateStep,
    hasStep,
    hasOpenModal,
  }
}
