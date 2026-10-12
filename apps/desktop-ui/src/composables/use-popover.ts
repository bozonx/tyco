import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/** A focusable popover closes on outside click, Escape, or focus leaving it. */
export function usePopover() {
  const isOpen = ref(false)
  const containerRef = ref<HTMLElement | null>(null)
  const triggerRef = ref<HTMLButtonElement | null>(null)

  function close(restoreFocus = false) {
    isOpen.value = false
    if (restoreFocus) triggerRef.value?.focus()
  }
  function toggle() {
    isOpen.value = !isOpen.value
  }
  function onDocumentClick(event: MouseEvent) {
    if (
      event.target instanceof Node &&
      !containerRef.value?.contains(event.target)
    )
      close()
  }
  function onEscape(event: KeyboardEvent) {
    if (
      isOpen.value &&
      event.key === 'Escape' &&
      containerRef.value?.contains(document.activeElement)
    ) {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
  }
  async function onFocusout(event: FocusEvent) {
    if (event.relatedTarget instanceof Node) {
      if (!containerRef.value?.contains(event.relatedTarget)) close()
      return
    }
    await nextTick()
    if (!containerRef.value?.contains(document.activeElement)) close()
  }
  function removeListeners() {
    document.removeEventListener('click', onDocumentClick, true)
    document.removeEventListener('keydown', onEscape)
  }
  watch(isOpen, (open) => {
    removeListeners()
    if (open) {
      document.addEventListener('click', onDocumentClick, true)
      document.addEventListener('keydown', onEscape)
    }
  })
  onBeforeUnmount(removeListeners)
  return {
    isOpen,
    containerRef,
    triggerRef,
    toggle,
    close,
    onFocusout,
    onEscape,
  }
}
