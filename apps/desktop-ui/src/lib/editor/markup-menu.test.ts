import { describe, expect, it, vi } from 'vitest'

import { buildMarkupItems } from './markup-menu'

describe('buildMarkupItems', () => {
  it('runs the formatting commands and shows their shortcuts', () => {
    const run = vi.fn()
    const items = buildMarkupItems({
      t: (key) => key,
      run,
      showMarkup: false,
      toggleShowMarkup: vi.fn(),
    })

    const bold = items.find((item) => item.id === 'markup-bold')!
    expect(bold).toMatchObject({
      label: 'editor.markup.bold',
      shortcut: 'Ctrl+B',
    })
    void bold.action?.()
    expect(run).toHaveBeenCalledWith('bold')
  })

  it('ends with the raw markup switch showing its state', () => {
    const toggleShowMarkup = vi.fn()
    const sources = { t: (key: string) => key, run: vi.fn(), toggleShowMarkup }

    const off = buildMarkupItems({ ...sources, showMarkup: false }).at(-1)!
    const on = buildMarkupItems({ ...sources, showMarkup: true }).at(-1)!

    expect(off.id).toBe('markup-show-source')
    expect(off.icon).toBe('mdi:checkbox-blank-outline')
    expect(on.icon).toBe('mdi:checkbox-marked-outline')
    void on.action?.()
    expect(toggleShowMarkup).toHaveBeenCalled()
  })
})
