import { describe, expect, it, vi } from 'vitest'

import {
  getToolbarLabel,
  getToolbarTooltip,
  isToolbarItemDisabled,
  isToolbarItemSquare,
  scopedActionLabel,
} from './editor-toolbar-item'

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key

describe('editor-toolbar-item', () => {
  it('formats selection-scoped action labels only when a selection exists', () => {
    expect(scopedActionLabel('Copy', false, t)).toBe('Copy')
    expect(scopedActionLabel('Copy', true, t)).toBe(
      'editor.appliesToSelection:{"action":"Copy"}'
    )
  })

  it('resolves toolbar tooltips and labels by priority', () => {
    const base = { id: 'item', position: 'left' as const, action: vi.fn() }
    expect(
      getToolbarTooltip({ ...base, tooltipKey: 'tool.tip', tooltip: 'Raw' }, t)
    ).toBe('tool.tip')
    expect(getToolbarTooltip({ ...base, tooltip: 'Raw' }, t)).toBe('Raw')
    expect(getToolbarTooltip({ ...base, labelKey: 'tool.label' }, t)).toBe(
      'tool.label'
    )
    expect(getToolbarLabel({ ...base, label: 'AB', labelKey: 'k' }, t)).toBe(
      'AB'
    )
    expect(getToolbarLabel({ ...base, labelKey: 'k' }, t)).toBe('k')
  })

  it('computes square shape and selection-dependent disabled state', () => {
    const base = {
      id: 'item',
      position: 'left' as const,
      selectionOnly: true,
      action: vi.fn(),
    }
    expect(isToolbarItemSquare('')).toBe(true)
    expect(isToolbarItemSquare('AB')).toBe(true)
    expect(isToolbarItemSquare('ABC')).toBe(false)
    expect(isToolbarItemDisabled(base, false)).toBe(true)
    expect(isToolbarItemDisabled(base, true)).toBe(false)
  })
})
