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
