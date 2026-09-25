import { describe, expect, it } from 'vitest'

import { DRAFT_RESTORE_MS, shouldRestoreDraft } from './draft-restore'

describe('shouldRestoreDraft', () => {
  it('restores a recently dismissed text', () => {
    expect(shouldRestoreDraft('draft', 1000, 1000 + DRAFT_RESTORE_MS)).toBe(
      true
    )
  })

  it('drops a text dismissed too long ago', () => {
    expect(shouldRestoreDraft('draft', 1000, 1001 + DRAFT_RESTORE_MS)).toBe(
      false
    )
  })

  it('does not restore without a dismissal or without text', () => {
    expect(shouldRestoreDraft('draft', null, 1000)).toBe(false)
    expect(shouldRestoreDraft('  ', 1000, 1000)).toBe(false)
  })
})
