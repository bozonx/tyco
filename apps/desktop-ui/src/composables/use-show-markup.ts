import { storeToRefs } from 'pinia'

import { useMarkupModeStore } from '../stores/markup-mode'

export function useShowMarkup() {
  const store = useMarkupModeStore()
  const { showMarkup } = storeToRefs(store)
  return {
    showMarkup,
    setShowMarkup: store.setShowMarkup,
    toggleShowMarkup: store.toggleShowMarkup,
    resetShowMarkup: store.resetShowMarkup,
  }
}
