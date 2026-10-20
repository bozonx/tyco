import { describe, expect, it, vi } from 'vitest'

import { createDismissibleLayerStack } from './dismissible-layer-stack'

describe('createDismissibleLayerStack', () => {
  it('pushes and removes layers and cleans up via clear()', () => {
    const stack = createDismissibleLayerStack()
    const firstDismiss = vi.fn()
    const secondDismiss = vi.fn()
    const first = {
      isOpen: () => true,
      elements: () => [],
      dismiss: firstDismiss,
    }
    const second = {
      isOpen: () => true,
      elements: () => [],
      dismiss: secondDismiss,
    }

    stack.sync(first, true)
    stack.sync(second, true)
    expect(stack.layers).toEqual([first, second])

    stack.sync(second, false)
    expect(stack.layers).toEqual([first])

    stack.clear()
    expect(stack.layers).toEqual([])
  })
})

it('consumes the release and repeats after the dismissed layer is removed', () => {
  const stack = createDismissibleLayerStack()
  const underlyingKeyup = vi.fn()
  const dismiss = vi.fn(() => stack.remove(layer))
  const layer = { isOpen: () => true, elements: () => [], dismiss }
  stack.sync(layer, true)
  window.addEventListener('keyup', underlyingKeyup)
  try {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    )
    const repeat = new KeyboardEvent('keydown', {
      key: 'Escape',
      repeat: true,
      cancelable: true,
    })
    window.dispatchEvent(repeat)
    expect(repeat.defaultPrevented).toBe(true)
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', cancelable: true })
    )
    expect(dismiss).toHaveBeenCalledOnce()
    expect(underlyingKeyup).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('keyup', underlyingKeyup)
    stack.clear()
  }
})

it('does not dismiss another layer until Escape is released', () => {
  const stack = createDismissibleLayerStack()
  const lower = { isOpen: () => true, elements: () => [], dismiss: vi.fn() }
  const upper = {
    isOpen: () => true,
    elements: () => [],
    dismiss: vi.fn(() => stack.remove(upper)),
  }
  stack.sync(lower, true)
  stack.sync(upper, true)
  try {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', repeat: true })
    )
    expect(lower.dismiss).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(lower.dismiss).toHaveBeenCalledOnce()
  } finally {
    stack.clear()
  }
})

it('lets focused controls consume Escape before the base navigation layer', () => {
  const stack = createDismissibleLayerStack()
  const dismiss = vi.fn()
  const input = document.createElement('input')
  document.body.append(input)
  input.addEventListener('keydown', (event) => event.preventDefault())
  stack.sync(
    {
      isOpen: () => true,
      elements: () => [],
      dismiss,
      keyboardPhase: 'bubble',
    },
    true
  )
  try {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    )
    expect(dismiss).not.toHaveBeenCalled()
  } finally {
    input.remove()
    stack.clear()
  }
})
