import { computed, onBeforeUnmount, ref, type Ref } from 'vue'

import {
  resolveItemShift,
  resolveTargetIndex,
  type SortableRect,
} from '../lib/sortable/sortable-list'

const ITEM_SELECTOR = ':scope > [data-sortable-item]'
const AUTO_SCROLL_EDGE = 40
const AUTO_SCROLL_MAX_STEP = 16

interface DragSession {
  from: number
  pointerId: number
  handle: HTMLElement
  rects: SortableRect[]
  startY: number
  clientY: number
  scroller: HTMLElement | null
  startScrollTop: number
  frame: number | null
}

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement

  while (current) {
    const { overflowY } = getComputedStyle(current)
    if (overflowY === 'auto' || overflowY === 'scroll') return current
    current = current.parentElement
  }

  return null
}

/**
 * Handle-driven reordering of a vertical list built on pointer events, so it
 * behaves the same in every webview regardless of native drag and drop. Items
 * are the container's direct children marked with `data-sortable-item`.
 */
export function useSortableList(
  container: Ref<HTMLElement | null>,
  onMove: (from: number, to: number) => void
) {
  const draggedIndex = ref<number | null>(null)
  const targetIndex = ref<number | null>(null)
  const offsetY = ref(0)
  let session: DragSession | null = null

  const isSorting = computed(() => draggedIndex.value !== null)

  const scrollDelta = (current: DragSession) =>
    current.scroller ? current.scroller.scrollTop - current.startScrollTop : 0

  const update = () => {
    if (!session) return

    offsetY.value = session.clientY - session.startY + scrollDelta(session)
    targetIndex.value = resolveTargetIndex(
      session.rects,
      session.from,
      offsetY.value
    )
  }

  const autoScroll = () => {
    if (!session?.scroller) return

    session.frame = null
    const bounds = session.scroller.getBoundingClientRect()
    let step = 0

    if (session.clientY < bounds.top + AUTO_SCROLL_EDGE) {
      step = -Math.min(
        AUTO_SCROLL_MAX_STEP,
        bounds.top + AUTO_SCROLL_EDGE - session.clientY
      )
    } else if (session.clientY > bounds.bottom - AUTO_SCROLL_EDGE) {
      step = Math.min(
        AUTO_SCROLL_MAX_STEP,
        session.clientY - (bounds.bottom - AUTO_SCROLL_EDGE)
      )
    }
    if (step === 0) return

    const before = session.scroller.scrollTop
    session.scroller.scrollTop += step
    if (session.scroller.scrollTop === before) return

    update()
    session.frame = requestAnimationFrame(autoScroll)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!session || event.pointerId !== session.pointerId) return

    session.clientY = event.clientY
    update()
    if (session.frame === null && session.scroller) {
      session.frame = requestAnimationFrame(autoScroll)
    }
  }

  const finish = (commit: boolean) => {
    const current = session
    if (!current) return

    session = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('blur', onCancel)
    if (current.frame !== null) cancelAnimationFrame(current.frame)
    if (current.handle.hasPointerCapture?.(current.pointerId)) {
      current.handle.releasePointerCapture(current.pointerId)
    }
    document.body.classList.remove('is-sorting')

    const to = targetIndex.value
    draggedIndex.value = null
    targetIndex.value = null
    offsetY.value = 0

    if (commit && to !== null && to !== current.from) onMove(current.from, to)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (session && event.pointerId === session.pointerId) finish(true)
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (session && event.pointerId === session.pointerId) finish(false)
  }

  const onCancel = () => finish(false)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return

    event.preventDefault()
    event.stopPropagation()
    finish(false)
  }

  const startDrag = (index: number, event: PointerEvent) => {
    if (session || event.button !== 0 || !container.value) return

    const items = Array.from(
      container.value.querySelectorAll<HTMLElement>(ITEM_SELECTOR)
    )
    if (!items[index]) return

    // Keeps focus where it is and stops text selection while dragging.
    event.preventDefault()

    const handle = event.currentTarget as HTMLElement
    const scroller = findScrollParent(container.value)
    session = {
      from: index,
      pointerId: event.pointerId,
      handle,
      rects: items.map((item) => {
        const rect = item.getBoundingClientRect()
        return { top: rect.top, height: rect.height }
      }),
      startY: event.clientY,
      clientY: event.clientY,
      scroller,
      startScrollTop: scroller?.scrollTop ?? 0,
      frame: null,
    }
    handle.setPointerCapture?.(event.pointerId)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onCancel)
    document.body.classList.add('is-sorting')

    draggedIndex.value = index
    targetIndex.value = index
    offsetY.value = 0
  }

  const itemOffset = (index: number): number => {
    if (!session || draggedIndex.value === null || targetIndex.value === null) {
      return 0
    }
    if (index === draggedIndex.value) return offsetY.value

    return resolveItemShift(
      session.rects,
      draggedIndex.value,
      targetIndex.value,
      index
    )
  }

  onBeforeUnmount(() => finish(false))

  return { draggedIndex, targetIndex, isSorting, startDrag, itemOffset }
}
