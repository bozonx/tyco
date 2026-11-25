import { describe, expect, it } from 'vitest'

import { createDialogId } from './dialog-id'

describe('createDialogId', () => {
  it('formats a sortable filesystem-safe id with a 6-character hex suffix', () => {
    const timestamp = new Date(2026, 10, 21, 9, 5, 3).getTime()
    expect(createDialogId(timestamp, 'A1B2C3')).toBe(
      '2026-11-21_09-05-03_a1b2c3'
    )
  })

  it('pads a short suffix and generates unique random suffixes by default', () => {
    const timestamp = new Date(2026, 0, 2, 3, 4, 5).getTime()
    expect(createDialogId(timestamp, 'ff')).toBe('2026-01-02_03-04-05_ff0000')
    expect(createDialogId(timestamp)).toMatch(
      /^2026-01-02_03-04-05_[0-9a-f]{6}$/
    )
  })
})
