import { describe, expect, it } from 'vitest'

import {
  configProfileFields,
  configProfileKey,
  joinRef,
  splitRef,
} from './profile-ref'

describe('profile references', () => {
  it('name the workspace except the main one', () => {
    expect(joinRef('', 'writer')).toBe('writer')
    expect(joinRef('w1', 'writer')).toBe('w1:writer')
    expect(splitRef('w1:writer')).toEqual({ workspaceId: 'w1', id: 'writer' })
    expect(splitRef('writer')).toEqual({ workspaceId: '', id: 'writer' })
  })

  it('are kept in the settings with an optional workspace', () => {
    expect(configProfileFields('writer')).toEqual({ profileId: 'writer' })
    expect(configProfileFields('w1:writer')).toEqual({
      profileId: 'writer',
      vaultId: 'w1',
    })
    expect(configProfileKey({ profileId: 'writer', vaultId: '' })).toBe(
      'writer'
    )
    expect(configProfileKey({ profileId: 'writer', vaultId: 'w1' })).toBe(
      'w1:writer'
    )
  })
})
