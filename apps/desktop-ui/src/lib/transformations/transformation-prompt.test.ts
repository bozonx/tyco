import { describe, expect, it } from 'vitest'

import {
  addTransformationFromPrompt,
  newTransformationId,
  transformationNameFromPrompt,
} from './transformation-prompt'

describe('transformation prompts', () => {
  it('generates unique transformation ids', () => {
    expect(newTransformationId([])).toBe('transformation-1')
    expect(
      newTransformationId([
        { id: 'transformation-1' },
        { id: 'transformation-2' },
      ])
    ).toBe('transformation-3')
  })

  it('cuts prompt name at limit', () => {
    expect(transformationNameFromPrompt('Short')).toBe('Short')
    expect(
      transformationNameFromPrompt(
        'A very long first line of a prompt that exceeds thirty two characters'
      )
    ).toBe('A very long first line of a pro…')
  })

  it('adds transformation from prompt to first free slot', () => {
    const library = { items: [], slots: {} }
    const updated = addTransformationFromPrompt(library, 'Format code')
    expect(updated?.outcome).toBe('added')
    expect(updated?.library.slots.q).toBe('transformation-1')
    expect(updated?.library.items[0]?.rule).toBe('Format code')
  })
})
