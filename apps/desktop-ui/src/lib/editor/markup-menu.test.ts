import { describe, expect, it, vi } from 'vitest'

import { buildMarkupItems } from './markup-menu'

describe('buildMarkupItems', () => {
  it('runs the formatting commands and shows their shortcuts', () => {
    const run = vi.fn()
    const items = buildMarkupItems({
      t: (key) => key,
      run,
      isMarkupShown: false,
      toggleShowMarkup: vi.fn(),
    })

    const bold = items.find((item) => item.id === 'markup-bold')!
    expect(bold).toMatchObject({
      label: 'editor.markup.bold',
      shortcut: 'Ctrl+B',
    })
    void bold.action?.()
    expect(run).toHaveBeenCalledWith('bold')

    const normalText = items.find((item) => item.id === 'markup-normalText')!
    expect(normalText).toMatchObject({
      label: 'editor.markup.normalText',
      shortcut: 'Ctrl+0',
    })

    const quote = items.find((item) => item.id === 'markup-quote')!
    expect(quote).toMatchObject({
      label: 'editor.markup.quote',
      shortcut: 'Ctrl+Shift+.',
    })

    const heading4 = items.find((item) => item.id === 'markup-heading4')!
    expect(heading4.shortcut).toBeUndefined()
  })

  it('ends with the raw markup switch showing its state', () => {
    const toggleShowMarkup = vi.fn()
    const sources = { t: (key: string) => key, run: vi.fn(), toggleShowMarkup }

    const off = buildMarkupItems({ ...sources, isMarkupShown: false }).at(-1)!
    const on = buildMarkupItems({ ...sources, isMarkupShown: true }).at(-1)!

    expect(off.id).toBe('markup-show-source')
    expect(off.icon).toBe('mdi:checkbox-blank-outline')
    expect(on.icon).toBe('mdi:checkbox-marked-outline')
    void on.action?.()
    expect(toggleShowMarkup).toHaveBeenCalled()
  })
})
