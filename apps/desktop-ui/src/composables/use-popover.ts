import { nextTick, ref } from 'vue'

import {
  isWithinDismissibleLayer,
  useDismissibleLayer,
} from './use-dismissible-layer'

/** A focusable popover closes on outside click, Escape, or focus leaving it. */
export function usePopover() {
  const isOpen = ref(false)
  const containerRef = ref<HTMLElement | null>(null)
  const panelRef = ref<HTMLElement | null>(null)
  const triggerRef = ref<{ focus: () => void } | null>(null)

  function close(restoreFocus = false) {
    isOpen.value = false
    if (restoreFocus) triggerRef.value?.focus()
  }
  function toggle() {
    isOpen.value = !isOpen.value
  }
  function contains(target: Node | null) {
    return isWithinDismissibleLayer(
      [containerRef.value, panelRef.value],
      target
    )
  }
  function onEscape(event: KeyboardEvent) {
    if (
      isOpen.value &&
      event.key === 'Escape' &&
      contains(document.activeElement)
    ) {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
  }
  async function onFocusout(event: FocusEvent) {
    if (event.relatedTarget instanceof Node) {
      if (!contains(event.relatedTarget)) close()
      return
    }
    await nextTick()
    if (!contains(document.activeElement)) close()
  }
  useDismissibleLayer({
    isOpen: () => isOpen.value,
    elements: () => [containerRef.value, panelRef.value],
    dismiss: () => close(),
    keydown: onEscape,
  })
  return {
    isOpen,
    containerRef,
    panelRef,
    triggerRef,
    toggle,
    close,
    onFocusout,
    onEscape,
  }
}
