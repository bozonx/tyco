export interface DismissibleLayer {
  isOpen: () => boolean
  elements: () => (HTMLElement | null | undefined)[]
  dismiss: () => void
  keydown?: (event: KeyboardEvent) => void
  canDismissOutside?: boolean
  keyboardPhase?: 'capture' | 'bubble'
  outsideEvent?: 'click' | 'mousedown'
}

export function createDismissibleLayerStack() {
  const layers: DismissibleLayer[] = []
  let isEscapeHeld = false

  function onKeyup(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !isEscapeHeld) return
    isEscapeHeld = false
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!layers.length) {
      window.removeEventListener('keyup', onKeyup, true)
      window.removeEventListener('keydown', onKeydown, true)
      window.removeEventListener('keydown', onBubbleKeydown)
      window.removeEventListener('blur', onBlur)
    }
  }

  function onBlur() {
    isEscapeHeld = false
    if (!layers.length) {
      window.removeEventListener('keyup', onKeyup, true)
      window.removeEventListener('keydown', onKeydown, true)
      window.removeEventListener('keydown', onBubbleKeydown)
      window.removeEventListener('blur', onBlur)
    }
  }

  /** Include teleported descendants whose trigger belongs to this layer. */
  function isWithinDismissibleLayer(
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
      layer.canDismissOutside !== false &&
      event.type === (layer.outsideEvent ?? 'click') &&
      !isWithinDismissibleLayer(layer.elements(), event.target)
    )
      layer.dismiss()
  }

  function onKeydown(event: KeyboardEvent) {
    handleKeydown(event, 'capture')
  }

  function onBubbleKeydown(event: KeyboardEvent) {
    handleKeydown(event, 'bubble')
  }

  function handleKeydown(event: KeyboardEvent, phase: 'capture' | 'bubble') {
    if (event.defaultPrevented) return
    if (event.key === 'Escape' && (isEscapeHeld || event.repeat)) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    const layer = layers.at(-1)
    if (!layer || (layer.keyboardPhase ?? 'capture') !== phase) return
    const dialog =
      event.target instanceof Element
        ? event.target.closest('dialog[open]')
        : null
    if (
      dialog &&
      !layer.elements().some((element) => element && dialog.contains(element))
    )
      return
    if (event.key === 'Escape') {
      isEscapeHeld = true
      window.addEventListener('keyup', onKeyup, true)
    }
    if (layer.keydown) layer.keydown(event)
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      layer.dismiss()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  function remove(layer: DismissibleLayer) {
    const index = layers.indexOf(layer)
    if (index >= 0) layers.splice(index, 1)
    if (!layers.length) {
      document.removeEventListener('click', onPointer, true)
      document.removeEventListener('mousedown', onPointer, true)
      if (!isEscapeHeld) {
        window.removeEventListener('keydown', onKeydown, true)
        window.removeEventListener('keydown', onBubbleKeydown)
        window.removeEventListener('keyup', onKeyup, true)
        window.removeEventListener('blur', onBlur)
      }
    }
  }

  function sync(layer: DismissibleLayer, open: boolean) {
    remove(layer)
    if (!open) return
    if (!layers.length) {
      document.addEventListener('click', onPointer, true)
      document.addEventListener('mousedown', onPointer, true)
      window.addEventListener('keydown', onKeydown, true)
      window.addEventListener('keydown', onBubbleKeydown)
      window.addEventListener('blur', onBlur)
    }
    layers.push(layer)
  }

  function clear() {
    layers.length = 0
    isEscapeHeld = false
    window.removeEventListener('keyup', onKeyup, true)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('click', onPointer, true)
    document.removeEventListener('mousedown', onPointer, true)
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('keydown', onBubbleKeydown)
  }

  return { layers, isWithinDismissibleLayer, remove, sync, clear }
}
