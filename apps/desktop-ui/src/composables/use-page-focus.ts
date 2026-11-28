import { onMounted, onUnmounted, ref } from 'vue'

/** How long the focus may be on its way before the page counts as left */
const FOCUS_SETTLE_MS = 400

/**
 * Whether this page has been without the keyboard focus for a moment: without
 * it the keys of its views never arrive, even while its window is shown. The
 * moment lets a window that is just being shown get the focus
 */
export function usePageFocus(settleMs = FOCUS_SETTLE_MS) {
  const isFocusAway = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const update = () => {
    clearTimeout(timer)
    if (document.hasFocus()) {
      isFocusAway.value = false
      return
    }
    timer = setTimeout(() => {
      isFocusAway.value = !document.hasFocus()
    }, settleMs)
  }
  onMounted(() => {
    update()
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
  })
  onUnmounted(() => {
    clearTimeout(timer)
    window.removeEventListener('focus', update)
    window.removeEventListener('blur', update)
  })
  return { isFocusAway }
}
