import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'

import { placeAnchoredPanel } from '../lib/ui/floating-position'

/** Shared measurement and viewport tracking for anchored floating surfaces. */
export function useAnchoredPanel(options: {
  isOpen: () => boolean
  anchor: () => HTMLElement | null
  panel: () => HTMLElement | null
  placement: () => 'top' | 'bottom'
  align: () => 'start' | 'center' | 'end'
  enabled?: () => boolean
}) {
  const style = ref<CSSProperties>({})
  const placement = ref(options.placement())
  const theme = ref<string>()
  let observer: ResizeObserver | undefined
  let version = 0

  function updatePosition() {
    const anchor = options.anchor()
    const panel = options.panel()
    theme.value =
      anchor?.closest('[data-theme]')?.getAttribute('data-theme') ?? undefined
    if (options.enabled?.() === false) {
      placement.value = options.placement()
      style.value = {}
      return
    }
    if (!anchor || !panel) return
    const position = placeAnchoredPanel(
      anchor.getBoundingClientRect(),
      panel.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      options.placement(),
      options.align()
    )
    placement.value = position.placement
    style.value = {
      position: 'fixed',
      top: `${Math.round(position.y)}px`,
      left: `${Math.round(position.x)}px`,
      bottom: 'auto',
      right: 'auto',
    }
  }
  function cleanup() {
    observer?.disconnect()
    window.removeEventListener('scroll', updatePosition, true)
    window.removeEventListener('resize', updatePosition)
  }
  watch(
    () => [options.isOpen(), options.placement(), options.align()],
    async () => {
      const current = ++version
      cleanup()
      if (!options.isOpen()) return
      await nextTick()
      if (current !== version) return
      updatePosition()
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(updatePosition)
        const anchor = options.anchor()
        const panel = options.panel()
        if (anchor) observer.observe(anchor)
        if (panel) observer.observe(panel)
      }
    },
    { immediate: true }
  )
  onBeforeUnmount(() => {
    version++
    cleanup()
  })
  return { style, placement, theme, updatePosition }
}
