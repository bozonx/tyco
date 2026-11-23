import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { isTextEntryTarget } from '../lib/ui/text-entry-target'
import { useActionMenuStore } from '../stores/action-menu'

export interface ActionPagesOptions {
  /** Only the pages whose actions take text, as on a result window. */
  textOnly?: boolean
  /** While true, the page keys do nothing. */
  isDisabled?: () => boolean
}

/**
 * The action pages a window offers and their keys: Tab and Shift+Tab or
 * PageDown and PageUp step through them, a digit opens a page by its number (0
 * is the tenth). A text field keeps these keys for itself.
 */
export function useActionPages(options: ActionPagesOptions = {}) {
  const actionMenuStore = useActionMenuStore()
  const pageIndexes = computed<readonly number[]>(() =>
    options.textOnly
      ? actionMenuStore.textPageIndexes
      : Array.from({ length: actionMenuStore.pageCount }, (_, index) => index)
  )
  const hasPages = computed(() => pageIndexes.value.length > 1)
  /** Which way the action slots slide when the page changes. */
  const motionDirection = ref(1)

  watch(
    () => actionMenuStore.pageIndex,
    (index, previous) => {
      motionDirection.value = index > previous ? 1 : -1
    },
    { flush: 'sync' }
  )

  function stepPage(direction: 1 | -1) {
    actionMenuStore.stepPageWithin(pageIndexes.value, direction)
    // a wrap-around still slides the way the user stepped
    motionDirection.value = direction
  }

  function selectPage(pageIndex: number) {
    if (pageIndexes.value.includes(pageIndex))
      actionMenuStore.setPage(pageIndex)
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (options.isDisabled?.() || !hasPages.value) return
    if (event.isComposing) return
    if (isTextEntryTarget(event.target)) return
    if (event.ctrlKey || event.altKey || event.metaKey) return

    if (event.key === 'Tab') {
      event.preventDefault()
      stepPage(event.shiftKey ? -1 : 1)
    } else if (event.key === 'PageDown') {
      event.preventDefault()
      stepPage(1)
    } else if (event.key === 'PageUp') {
      event.preventDefault()
      stepPage(-1)
    } else if (/^[0-9]$/.test(event.key)) {
      const target = event.key === '0' ? 9 : Number(event.key) - 1
      if (pageIndexes.value.includes(target)) {
        event.preventDefault()
        actionMenuStore.setPage(target)
      }
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))

  return { pageIndexes, hasPages, motionDirection, stepPage, selectPage }
}
