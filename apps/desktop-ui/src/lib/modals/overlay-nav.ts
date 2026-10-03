import { computed } from 'vue'

import { MenuModals } from './menu-modals-store'

export interface OverlayNavDependencies {
  currentModal: () => MenuModals
  canGoBack: () => boolean
  isQuickWindow: () => boolean
  t: (key: string) => string
  goBack: () => void
  closeWindow: () => void
}

export interface OverlayNavOptions {
  escMode?: 'close' | 'back' | 'auto'
  escLabel?: string
  onEsc?: () => void
}

export function createOverlayNavModel(
  deps: OverlayNavDependencies,
  options: () => OverlayNavOptions = () => ({})
) {
  const resolvedEscMode = computed<'close' | 'back'>(() => {
    const opts = options()
    if (opts.escMode && opts.escMode !== 'auto') {
      return opts.escMode
    }

    if (deps.canGoBack()) {
      return 'back'
    }

    const modal = deps.currentModal()
    if (modal === MenuModals.NONE) {
      return 'close'
    }

    if (
      modal === MenuModals.AI_TASK ||
      modal === MenuModals.TRANSLATE ||
      modal === MenuModals.ACTION_SELECT
    ) {
      return 'back'
    }

    return 'close'
  })

  const escLabel = computed<string>(() => {
    const opts = options()
    if (opts.escLabel) {
      return opts.escLabel
    }

    if (resolvedEscMode.value === 'back') {
      return deps.t('common.back')
    }

    return deps.isQuickWindow()
      ? deps.t('common.cancel')
      : deps.t('common.close')
  })

  const handleEsc = () => {
    const opts = options()
    if (opts.onEsc) {
      opts.onEsc()
      return
    }

    if (resolvedEscMode.value === 'back') {
      deps.goBack()
    } else {
      deps.closeWindow()
    }
  }

  return { resolvedEscMode, escLabel, handleEsc }
}
