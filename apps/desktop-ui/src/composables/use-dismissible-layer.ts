import { onBeforeUnmount, watch } from 'vue'

interface DismissibleLayer {
  isOpen: () => boolean
  elements: () => (HTMLElement | null | undefined)[]
  dismiss: () => void
  keydown?: (event: KeyboardEvent) => void
  outsideEvent?: 'click' | 'mousedown'
}

const layers: DismissibleLayer[] = []

/** Include teleported descendants whose trigger belongs to this layer. */
export function isWithinDismissibleLayer(
  elements: (HTMLElement | null | undefined)[],
  target: EventTarget | null,
  visited = new Set<DismissibleLayer>()
): boolean {
  if (!(target instanceof Node)) return false
  if (elements.some((element) => element?.contains(target))) return true
  return layers.some((layer) => {
    if (visited.has(layer)) return false
    const descendants = layer.elements()
    if (
      !descendants.some(
        (child) =>
          child &&
          elements.some(
            (parent) => parent && parent !== child && parent.contains(child)
          )
      )
    )
      return false
    visited.add(layer)
    return isWithinDismissibleLayer(descendants, target, visited)
  })
}

function onPointer(event: MouseEvent) {
  const layer = layers.at(-1)
  if (
    layer &&
    event.type === (layer.outsideEvent ?? 'click') &&
    !isWithinDismissibleLayer(layer.elements(), event.target)
  )
    layer.dismiss()
}

function onKeydown(event: KeyboardEvent) {
  const layer = layers.at(-1)
  if (!layer) return
  const dialog =
    event.target instanceof Element
      ? event.target.closest('dialog[open]')
      : null
  if (
    dialog &&
    !layer.elements().some((element) => element && dialog.contains(element))
  )
    return
  if (layer.keydown) layer.keydown(event)
  else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    layer.dismiss()
  }
}

/**
 * Only the top open layer handles outside interaction and global keyboard
 * events.
 */
export function useDismissibleLayer(layer: DismissibleLayer) {
  function remove() {
    const index = layers.indexOf(layer)
    if (index >= 0) layers.splice(index, 1)
    if (!layers.length) {
      document.removeEventListener('click', onPointer, true)
      document.removeEventListener('mousedown', onPointer, true)
      window.removeEventListener('keydown', onKeydown, true)
    }
  }
  watch(
    layer.isOpen,
    (open) => {
      remove()
      if (!open) return
      if (!layers.length) {
        document.addEventListener('click', onPointer, true)
        document.addEventListener('mousedown', onPointer, true)
        window.addEventListener('keydown', onKeydown, true)
      }
      layers.push(layer)
    },
    { immediate: true, flush: 'sync' }
  )
  onBeforeUnmount(remove)
}
