import { describe, expect, it } from 'vitest'

import {
  savePromptToSlotLibrary,
  slotItemLabel,
  type SlotLibrary,
  type SlotLibraryItem,
} from './slot-library'

const library = (
  items: SlotLibraryItem[],
  slots: SlotLibrary<SlotLibraryItem>['slots'] = {}
): SlotLibrary<SlotLibraryItem> => ({ items, slots })

const item = (id: string, rule: string, name = ''): SlotLibraryItem => ({
  id,
  name,
  rule,
})

describe('savePromptToSlotLibrary', () => {
  it('refuses an empty request', () => {
    expect(savePromptToSlotLibrary(library([]), '  ', 'x')).toBe(null)
  })

  it('adds a request to the first free slot', () => {
    const result = savePromptToSlotLibrary(library([]), ' Be brief ', 'x')
    expect(result?.outcome).toBe('added')
    expect(result?.library.items).toEqual([item('x-1', 'Be brief', 'Be brief')])
    expect(result?.library.slots.q).toBe('x-1')
  })

  it('tells a request already shown in the menu', () => {
    const shown = library([item('x-1', 'Be brief')], { w: 'x-1' })
    expect(savePromptToSlotLibrary(shown, 'Be brief', 'x')).toEqual({
      library: shown,
      outcome: 'exists',
    })
  })

  it('places a saved request that has no slot instead of adding it', () => {
    const result = savePromptToSlotLibrary(
      library([item('x-1', 'Be brief')]),
      'Be brief',
      'x'
    )
    expect(result?.outcome).toBe('placed')
    expect(result?.library.items).toHaveLength(1)
    expect(result?.library.slots.q).toBe('x-1')
  })
})

describe('slotItemLabel', () => {
  it('falls back to the rule when the name is empty', () => {
    expect(slotItemLabel(item('x', 'Make it formal'))).toBe('Make it formal')
    expect(slotItemLabel(item('x', 'Rule', 'Name'))).toBe('Name')
  })
})
