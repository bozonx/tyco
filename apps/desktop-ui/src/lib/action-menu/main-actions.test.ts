import { DEFAULT_MAIN_ACTIONS } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { normalizeMainActions } from './main-actions'

describe('normalizeMainActions', () => {
  it('creates the standard actions for a missing config', () => {
    expect(normalizeMainActions(undefined).slice(0, 6)).toEqual(
      DEFAULT_MAIN_ACTIONS
    )
  })

  it('keeps valid slots and removes unsupported actions', () => {
    expect(
      normalizeMainActions([
        null,
        { type: 'standard', actionId: 'translation' },
        { type: 'custom', command: 'echo nope' },
        { type: 'standard', actionId: 'unknown' },
      ]).slice(0, 4)
    ).toEqual([null, { type: 'standard', actionId: 'translation' }, null, null])
  })
})
