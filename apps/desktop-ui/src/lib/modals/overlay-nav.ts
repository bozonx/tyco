import { computed } from 'vue'

import type { MenuModals } from './menu-modals-model'

export interface OverlayNavDependencies {
  currentModal: () => MenuModals
  canGoBack: () => boolean
  isQuickWindow: () => boolean
  t: (key: string) => string
  goBack: () => void
  hideWindow: () => void
  closeAll?: () => void
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

    return deps.canGoBack() ? 'back' : 'close'
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

  const escTitle = computed<string>(() => deps.t('common.closeAllHint'))

  const handleEsc = () => {
    const opts = options()
    if (opts.onEsc) {
      opts.onEsc()
      return
    }

    if (resolvedEscMode.value === 'back') {
      deps.goBack()
    } else {
      deps.hideWindow()
    }
  }

  const handleCloseAll = () => {
    if (deps.closeAll) {
      deps.closeAll()
    } else {
      deps.hideWindow()
    }
  }

  return { resolvedEscMode, escLabel, escTitle, handleEsc, handleCloseAll }
}
