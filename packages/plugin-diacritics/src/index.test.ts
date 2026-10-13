import { describe, expect, it } from 'vitest'

import { createPluginTestContext } from '@tyco/plugin-sdk/testing'
import diacritics from './index.js'

describe('diacritics plugin', () => {
  it('registers default toolbar items with position left and selectionOnly', () => {
    const { ctx, toolbarItems } = createPluginTestContext()
    diacritics().init(ctx)

    expect(toolbarItems).toHaveLength(1)
    expect(toolbarItems[0].id).toBe('diacritics-acute')
    expect(toolbarItems[0].position).toBe('left')
    expect(toolbarItems[0].selectionOnly).toBe(true)
    expect(toolbarItems[0].label).toBe('◌́')
    expect(toolbarItems[0].tooltipKey).toBe('local.acute')
  })

  it('registers user-configured actions in custom order', () => {
    const { ctx, toolbarItems } = createPluginTestContext({
      config: {
        actions: [
          { id: 'circumflex', enabled: true },
          { id: 'clearAcute', enabled: true },
          { id: 'acute', enabled: false },
        ],
      },
    })
    diacritics().init(ctx)

    expect(toolbarItems).toHaveLength(2)
    expect(toolbarItems[0].id).toBe('diacritics-circumflex')
    expect(toolbarItems[0].label).toBe('◌̂')
    expect(toolbarItems[1].id).toBe('diacritics-clear-acute')
    expect(toolbarItems[1].label).toBe('−◌́')
  })

  it('transforms selected text and focuses editor on action execution', async () => {
    const { ctx, mocks, toolbarItems } = createPluginTestContext({
      selectedText: 'e',
    })
    diacritics().init(ctx)

    const acuteItem = toolbarItems.find((i) => i.id === 'diacritics-acute')!
    await acuteItem.action()

    expect(mocks.replaceEditorInputSelection).toHaveBeenCalledWith('é')
    expect(mocks.setEditorInputFocus).toHaveBeenCalled()
  })

  it('warns when attempting action without selection', async () => {
    const { ctx, mocks, toolbarItems } = createPluginTestContext({
      selectedText: '',
    })
    diacritics().init(ctx)

    const acuteItem = toolbarItems.find((i) => i.id === 'diacritics-acute')!
    await acuteItem.action()

    expect(mocks.toast).toHaveBeenCalledWith('toast.textNotSelected', 'warn')
    expect(mocks.replaceEditorInputSelection).not.toHaveBeenCalled()
  })
})

describe('diacritics editor conflicts', () => {
  it('does not replace a changed editor selection after reading a snapshot', async () => {
    const { ctx, mocks, toolbarItems } = createPluginTestContext({
      value: 'a b',
      selectedText: 'a',
    })
    diacritics().init(ctx)
    const pending = toolbarItems[0].action()
    ctx.replaceEditorInputSelection('b')
    mocks.replaceEditorInputSelection.mockClear()
    await pending
    expect(await ctx.getEditorInputValue()).toBe('b b')
    expect(mocks.replaceEditorInputSelection).not.toHaveBeenCalled()
    expect(mocks.setEditorInputFocus).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('toast.textTransformStale', 'warn')
  })

  it('treats whitespace-only selections as empty', async () => {
    const { ctx, mocks, toolbarItems } = createPluginTestContext({
      selectedText: ' \n ',
    })
    diacritics().init(ctx)
    await toolbarItems[0].action()
    expect(mocks.applyEditorInputEdit).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('toast.textNotSelected', 'warn')
  })
})
