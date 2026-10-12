import { nextTick, onMounted, watch, type Ref } from 'vue'

export function useTextareaAutosize(
  element: Ref<HTMLTextAreaElement | null>,
  value: () => string | undefined,
  options: () => { enabled: boolean; maxHeight: number }
) {
  function resize() {
    const textarea = element.value
    if (!textarea) return
    const { enabled, maxHeight } = options()
    if (!enabled) {
      textarea.style.height = ''
      textarea.style.overflowY = ''
      return
    }
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
    if (textarea.scrollHeight <= maxHeight) textarea.scrollTop = 0
  }
  watch([value, options], resize, { flush: 'post', deep: true })
  onMounted(async () => {
    await nextTick()
    resize()
  })
  return { resize }
}
