import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

import {
  resolveItemShift,
  resolveTargetIndex,
  type SortableRect,
} from '../lib/sortable/sortable-list'

const ITEM_SELECTOR = ':scope > [data-sortable-item]'
const AUTO_SCROLL_EDGE = 40
const AUTO_SCROLL_SPEED = 960
const DRAG_THRESHOLD = 4
let cancelActiveDrag: (() => void) | null = null

interface ScrollContainer {
  element: HTMLElement
  startScrollTop: number
}

interface DragSession {
  from: number
  pointerId: number
  handle: HTMLElement
  items: HTMLElement[]
  rects: SortableRect[]
  startY: number
  startX: number
  clientY: number
  clientX: number
  scrollers: ScrollContainer[]
  frame: number | null
  lastFrameTime: number | null
  active: boolean
}

function findScrollParents(element: HTMLElement): ScrollContainer[] {
  const result: ScrollContainer[] = []
  let current: HTMLElement | null = element
  while (current) {
    const { overflowY } = getComputedStyle(current)
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight
    ) {
      result.push({ element: current, startScrollTop: current.scrollTop })
    }
    current = current.parentElement
  }
  const root = document.scrollingElement as HTMLElement | null
  if (
    root &&
    root.scrollHeight > root.clientHeight &&
    !result.some(({ element }) => element === root)
  ) {
    result.push({ element: root, startScrollTop: root.scrollTop })
  }
  return result
}

/** Pointer-driven vertical reordering; swap mode preserves fixed shortcut slots. */
export function useSortableList(
  container: Ref<HTMLElement | null>,
  onMove: (from: number, to: number) => void,
  options: {
    mode?: 'sort' | 'swap'
    getItemKeys?: () => readonly unknown[]
  } = {}
) {
  const draggedIndex = ref<number | null>(null)
  const targetIndex = ref<number | null>(null)
  const offsetY = ref(0)
  let session: DragSession | null = null
  const isSorting = computed(() => draggedIndex.value !== null)
  const items = () =>
    Array.from(
      container.value?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []
    )
  const scrollDelta = (current: DragSession) =>
    current.scrollers.reduce(
      (sum, { element, startScrollTop }) =>
        sum + element.scrollTop - startScrollTop,
      0
    )

  const isValid = (current: DragSession) => {
    const next = items()
    return (
      next.length === current.items.length &&
      next.every(
        (item, index) =>
          item === current.items[index] &&
          item.getBoundingClientRect().height === current.rects[index].height
      )
    )
  }

  const update = () => {
    if (!session) return
    if (!isValid(session)) {
      finish(false)
      return
    }
    if (!session.active) {
      if (
        Math.hypot(
          session.clientX - session.startX,
          session.clientY - session.startY
        ) < DRAG_THRESHOLD
      )
        return
      session.active = true
      draggedIndex.value = session.from
      document.body.classList.add('is-sorting')
    }
    offsetY.value = session.clientY - session.startY + scrollDelta(session)
    if (options.mode === 'swap') {
      targetIndex.value = session.items.findIndex((item) => {
        const rect = item.getBoundingClientRect()
        return (
          session!.clientY >= rect.top &&
          session!.clientY <= rect.bottom &&
          session!.clientX >= rect.left &&
          session!.clientX <= rect.right
        )
      })
      if (targetIndex.value < 0) targetIndex.value = null
    } else {
      targetIndex.value = resolveTargetIndex(
        session.rects,
        session.from,
        offsetY.value
      )
    }
  }

  const autoScroll = (time: number) => {
    if (!session) return
    session.frame = null
    const elapsedSeconds =
      session.lastFrameTime === null
        ? 0
        : Math.min(time - session.lastFrameTime, 32) / 1000
    session.lastFrameTime = time
    for (const { element } of session.scrollers) {
      const bounds =
        element === document.scrollingElement
          ? {
              top: 0,
              bottom: window.innerHeight,
              left: 0,
              right: window.innerWidth,
            }
          : element.getBoundingClientRect()
      if (session.clientX < bounds.left || session.clientX > bounds.right)
        continue
      const edge = Math.min(AUTO_SCROLL_EDGE, (bounds.bottom - bounds.top) / 2)
      const direction =
        session.clientY < bounds.top + edge
          ? -Math.min(1, (bounds.top + edge - session.clientY) / edge)
          : session.clientY > bounds.bottom - edge
            ? Math.min(1, (session.clientY - bounds.bottom + edge) / edge)
            : 0
      const before = element.scrollTop
      element.scrollTop += direction * AUTO_SCROLL_SPEED * elapsedSeconds
      if (element.scrollTop !== before) break
    }
    update()
    if (session?.active) session.frame = requestAnimationFrame(autoScroll)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!session || event.pointerId !== session.pointerId) return
    session.clientY = event.clientY
    session.clientX = event.clientX
    update()
    if (
      session?.active &&
      session.scrollers.length > 0 &&
      session.frame === null
    )
      session.frame = requestAnimationFrame(autoScroll)
  }

  function finish(commit: boolean) {
    const current = session
    if (!current) return
    const valid = isValid(current)
    session = null
    if (cancelActiveDrag === onCancel) cancelActiveDrag = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('blur', onCancel)
    window.removeEventListener('resize', onCancel)
    window.removeEventListener('scroll', update, true)
    current.handle.removeEventListener('lostpointercapture', onPointerCancel)
    if (current.frame !== null) cancelAnimationFrame(current.frame)
    if (current.handle.hasPointerCapture?.(current.pointerId))
      current.handle.releasePointerCapture(current.pointerId)
    if (current.active) document.body.classList.remove('is-sorting')
    const to = targetIndex.value
    draggedIndex.value = null
    targetIndex.value = null
    offsetY.value = 0
    if (commit && valid && current.active && to !== null && to !== current.from)
      onMove(current.from, to)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!session || event.pointerId !== session.pointerId) return
    onPointerMove(event)
    finish(true)
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
    if (
      session ||
      event.button !== 0 ||
      event.isPrimary === false ||
      !container.value
    )
      return
    const currentItems = items()
    if (!currentItems[index]) return
    cancelActiveDrag?.()
    cancelActiveDrag = onCancel
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    session = {
      from: index,
      pointerId: event.pointerId,
      handle,
      items: currentItems,
      rects: currentItems.map((item) => {
        const rect = item.getBoundingClientRect()
        return { top: rect.top, height: rect.height }
      }),
      startY: event.clientY,
      startX: event.clientX,
      clientY: event.clientY,
      clientX: event.clientX,
      scrollers: findScrollParents(container.value),
      frame: null,
      lastFrameTime: null,
      active: false,
    }
    try {
      handle.setPointerCapture?.(event.pointerId)
    } catch {
      session = null
      cancelActiveDrag = null
      return
    }
    handle.addEventListener('lostpointercapture', onPointerCancel)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onCancel)
    window.addEventListener('resize', onCancel)
    window.addEventListener('scroll', update, true)
  }

  const itemOffset = (index: number): number => {
    if (
      options.mode === 'swap' ||
      !session ||
      draggedIndex.value === null ||
      targetIndex.value === null
    )
      return 0
    if (index === draggedIndex.value) return offsetY.value
    return resolveItemShift(
      session.rects,
      draggedIndex.value,
      targetIndex.value,
      index
    )
  }
  if (options.getItemKeys)
    watch(() => [...options.getItemKeys!()], onCancel, { flush: 'sync' })
  onBeforeUnmount(onCancel)
  return {
    draggedIndex,
    targetIndex,
    isSorting,
    startDrag,
    itemOffset,
    cancel: onCancel,
  }
}
