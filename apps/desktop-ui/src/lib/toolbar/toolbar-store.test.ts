import { describe, expect, it, vi } from 'vitest'

import type { ToolbarItem } from '../../types/plugins'
import { createToolbarStoreModel } from './toolbar-store'

describe('createToolbarStoreModel', () => {
  it('starts with empty toolbar items', () => {
    const store = createToolbarStoreModel()
    expect(store.getToolbarItems()).toHaveLength(0)
    expect(store.getLeftToolbarItems()).toHaveLength(0)
    expect(store.getRightToolbarItems()).toHaveLength(0)
  })

  it('registers and filters toolbar items by position', () => {
    const store = createToolbarStoreModel()

    const itemLeft: ToolbarItem = {
      id: 'tool-left',
      icon: 'mdi:wrench',
      position: 'left',
      action: vi.fn(),
    }

    const itemRightDefault: ToolbarItem = {
      id: 'tool-right-1',
      icon: 'mdi:star',
      action: vi.fn(),
    }

    const itemRightExplicit: ToolbarItem = {
      id: 'tool-right-2',
      icon: 'mdi:magnify',
      position: 'right',
      action: vi.fn(),
    }

    store.registerToolbarItems([itemLeft, itemRightDefault, itemRightExplicit])

    expect(store.getToolbarItems()).toHaveLength(3)
    expect(store.getLeftToolbarItems()).toEqual([itemLeft])
    expect(store.getRightToolbarItems()).toEqual([
      itemRightDefault,
      itemRightExplicit,
    ])
  })

  it('clears registered toolbar items', () => {
    const store = createToolbarStoreModel()

    const item: ToolbarItem = {
      id: 'tool-1',
      icon: 'mdi:star',
      action: vi.fn(),
    }

    store.registerToolbarItems([item])
    expect(store.getToolbarItems()).toHaveLength(1)

    store.clearToolbarItems()
    expect(store.getToolbarItems()).toHaveLength(0)
    expect(store.getLeftToolbarItems()).toHaveLength(0)
    expect(store.getRightToolbarItems()).toHaveLength(0)
  })
})
