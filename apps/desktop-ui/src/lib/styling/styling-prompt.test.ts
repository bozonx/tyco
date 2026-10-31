import { describe, expect, it } from 'vitest'

import {
  addStylingFromPrompt,
  newStylingId,
  stylingNameFromPrompt,
} from './styling-prompt'

describe('styling prompts', () => {
  it('generates unique styling ids', () => {
    expect(newStylingId([])).toBe('style-1')
    expect(newStylingId([{ id: 'style-1' }, { id: 'style-2' }])).toBe('style-3')
  })

  it('cuts prompt name at limit', () => {
    expect(stylingNameFromPrompt('Formal')).toBe('Formal')
    expect(
      stylingNameFromPrompt(
        'A very long first line of a prompt that exceeds thirty two characters'
      )
    ).toBe('A very long first line of a pro…')
  })

  it('adds styling from prompt to first free slot', () => {
    const library = { items: [], slots: {} }
    const updated = addStylingFromPrompt(library, 'Formal tone')
    expect(updated?.outcome).toBe('added')
    expect(updated?.library.slots.q).toBe('style-1')
    expect(updated?.library.items[0]?.rule).toBe('Formal tone')
  })
})
