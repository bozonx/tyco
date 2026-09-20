import { describe, expect, it, vi } from 'vitest'

import type { PluginContext, PluginIndex } from '../../types/plugins'
import { createPluginManager } from './plugin-manager'

describe('createPluginManager', () => {
  const createMockContext = (): PluginContext =>
    ({
      registerActionsItems: vi.fn(),
      registerEditItems: vi.fn(),
      registerCaseItems: vi.fn(),
      registerFormatItems: vi.fn(),
      registerToolbarItems: vi.fn(),
      getEditorInputValue: vi.fn(),
      getEditorInputSelectedText: vi.fn(),
      setEditorInputValue: vi.fn(),
      replaceEditorInputSelection: vi.fn(),
      setEditorInputFocus: vi.fn(),
      nextModal: vi.fn(),
      backModal: vi.fn(),
      closeAllModals: vi.fn(),
      setPendingModal: vi.fn(),
      clearPendingModal: vi.fn(),
      resetNavParams: vi.fn(),
      updateNavParams: vi.fn(),
      toEditor: vi.fn(),
      toast: vi.fn(),
      callApiFunction: vi.fn(),
      getUserConfig: vi.fn(),
    }) as unknown as PluginContext

  it('loads all plugins when no disabled status is specified', () => {
    const init1 = vi.fn()
    const init2 = vi.fn()

    const plugin1: PluginIndex = () => ({ name: 'Plugin1', init: init1 })
    const plugin2: PluginIndex = () => ({ name: 'Plugin2', init: init2 })

    const clearActionItems = vi.fn()
    const clearEditItems = vi.fn()
    const clearToolbarItems = vi.fn()

    const manager = createPluginManager({
      pluginIndexes: [plugin1, plugin2],
      createPluginContext: createMockContext,
      clearActionItems,
      clearEditItems,
      clearToolbarItems,
    })

    manager.loadPlugins({})

    expect(clearActionItems).toHaveBeenCalledTimes(1)
    expect(clearEditItems).toHaveBeenCalledTimes(1)
    expect(clearToolbarItems).toHaveBeenCalledTimes(1)
    expect(init1).toHaveBeenCalledTimes(1)
    expect(init2).toHaveBeenCalledTimes(1)
    expect(manager.getActivePluginNames()).toEqual(['Plugin1', 'Plugin2'])
  })

  it('skips plugins that are explicitly disabled', () => {
    const init1 = vi.fn()
    const init2 = vi.fn()

    const plugin1: PluginIndex = () => ({ name: 'Plugin1', init: init1 })
    const plugin2: PluginIndex = () => ({ name: 'Plugin2', init: init2 })

    const manager = createPluginManager({
      pluginIndexes: [plugin1, plugin2],
      createPluginContext: createMockContext,
      clearActionItems: vi.fn(),
      clearEditItems: vi.fn(),
      clearToolbarItems: vi.fn(),
    })

    manager.loadPlugins({
      plugins: { Plugin1: { enabled: false }, Plugin2: { enabled: true } },
    } as any)

    expect(init1).not.toHaveBeenCalled()
    expect(init2).toHaveBeenCalledTimes(1)
    expect(manager.getActivePluginNames()).toEqual(['Plugin2'])
  })

  it('correctly resets previous registrations upon reload', () => {
    const init1 = vi.fn()
    const plugin1: PluginIndex = () => ({ name: 'Plugin1', init: init1 })

    const clearActionItems = vi.fn()
    const clearEditItems = vi.fn()
    const clearToolbarItems = vi.fn()

    const manager = createPluginManager({
      pluginIndexes: [plugin1],
      createPluginContext: createMockContext,
      clearActionItems,
      clearEditItems,
      clearToolbarItems,
    })

    manager.loadPlugins({ plugins: { Plugin1: { enabled: true } } } as any)
    expect(manager.getActivePluginNames()).toEqual(['Plugin1'])

    // Reload with Plugin1 disabled
    manager.loadPlugins({ plugins: { Plugin1: { enabled: false } } } as any)
    expect(clearActionItems).toHaveBeenCalledTimes(2)
    expect(clearEditItems).toHaveBeenCalledTimes(2)
    expect(clearToolbarItems).toHaveBeenCalledTimes(2)
    expect(manager.getActivePluginNames()).toEqual([])
  })
})
