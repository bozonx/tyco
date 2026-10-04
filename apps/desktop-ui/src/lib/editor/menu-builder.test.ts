import { describe, expect, it, vi } from 'vitest'

import type { EditorMenuCommands, EditorMenuGroups } from './menu-builder'
import { actionIcon, ACTIONS_ICON, buildContextMenu } from './menu-builder'
import type { EditorMenuItem } from './menu-item'

const t = (key: string): string => key

const commands = (): EditorMenuCommands => ({
  undo: vi.fn(),
  redo: vi.fn(),
  cut: vi.fn(),
  copy: vi.fn(),
  paste: vi.fn(),
  pastePlain: vi.fn(),
  selectAll: vi.fn(),
})

const item = (id: string, extra: Partial<EditorMenuItem> = {}) => ({
  id,
  label: id,
  action: vi.fn(),
  ...extra,
})

const groups = (
  overrides: Partial<EditorMenuGroups> = {}
): EditorMenuGroups => ({
  caseItems: [item('upper'), item('lower')],
  formatItems: [item('md'), item('code')],
  otherEditItems: [],
  actionItems: [
    item('translation'),
    item('correction'),
    item('aiTask'),
    item('askInChat'),
  ],
  ...overrides,
})

const ids = (items: EditorMenuItem[]) => items.map((entry) => entry.id)

describe('buildContextMenu', () => {
  it('lists history and clipboard commands, then transforms folded into submenus', () => {
    const menu = buildContextMenu({
      t,
      commands: commands(),
      groups: groups(),
      selected: true,
      canUndo: true,
      canRedo: true,
    })

    expect(ids(menu)).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'paste-plain',
      'select-all',
      'actions',
      'case',
      'format',
    ])
    expect(ids(menu[7].children!)).toEqual([
      'translation',
      'correction',
      'aiTask',
      'askInChat',
    ])
    expect(ids(menu[8].children!)).toEqual(['upper', 'lower'])
    expect(menu[2].separatorBefore).toBe(true)
    expect(menu[7].separatorBefore).toBe(true)
  })

  it('controls undo and redo disabled state based on canUndo and canRedo', () => {
    const menuDisabled = buildContextMenu({
      t,
      commands: commands(),
      groups: groups(),
      selected: false,
      canUndo: false,
      canRedo: false,
    })

    expect(menuDisabled.find((entry) => entry.id === 'undo')?.disabled).toBe(
      true
    )
    expect(menuDisabled.find((entry) => entry.id === 'redo')?.disabled).toBe(
      true
    )

    const menuEnabled = buildContextMenu({
      t,
      commands: commands(),
      groups: groups(),
      selected: false,
      canUndo: true,
      canRedo: true,
    })

    expect(menuEnabled.find((entry) => entry.id === 'undo')?.disabled).toBe(
      false
    )
    expect(menuEnabled.find((entry) => entry.id === 'redo')?.disabled).toBe(
      false
    )
  })

  it('disables cut and copy without a selection', () => {
    const menu = buildContextMenu({
      t,
      commands: commands(),
      groups: groups(),
      selected: false,
    })

    expect(menu.find((entry) => entry.id === 'cut')?.disabled).toBe(true)
    expect(menu.find((entry) => entry.id === 'copy')?.disabled).toBe(true)
    expect(menu.find((entry) => entry.id === 'paste')?.disabled).toBeFalsy()
  })

  it('puts spelling suggestions on top, separated from history', () => {
    const menu = buildContextMenu({
      t,
      commands: commands(),
      groups: groups(),
      selected: false,
      suggestions: [item('fix', { accent: true })],
    })

    expect(menu[0].id).toBe('fix')
    expect(menu[1]).toMatchObject({ id: 'undo', separatorBefore: true })
  })

  it('drops empty submenus', () => {
    const menu = buildContextMenu({
      t,
      commands: commands(),
      groups: groups({ actionItems: [], formatItems: [] }),
      selected: false,
    })

    expect(ids(menu)).not.toContain('actions')
    expect(ids(menu)).not.toContain('format')
    expect(ids(menu)).toContain('case')
  })

  it('appends plugin edit items to the format submenu after a separator', () => {
    const menu = buildContextMenu({
      t,
      commands: commands(),
      groups: groups({ otherEditItems: [item('plugin')] }),
      selected: false,
    })
    const format = menu.find((entry) => entry.id === 'format')!

    expect(ids(format.children!)).toEqual(['md', 'code', 'plugin'])
    expect(format.children![2].separatorBefore).toBe(true)
  })
})

describe('actionIcon', () => {
  it('prefers the own icon, then the standard one, then the fallback', () => {
    expect(actionIcon('translation', 'mdi:star')).toBe('mdi:star')
    expect(actionIcon('translation')).toBe('mdi:translate')
    expect(actionIcon('plugin-x')).toBe(ACTIONS_ICON)
    expect(actionIcon()).toBe(ACTIONS_ICON)
  })
})
