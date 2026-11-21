import type { UserConfig } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { rewriteProfileRefs } from './profile-ref-rewrite'

const config = (value: Record<string, unknown>) =>
  value as unknown as UserConfig

describe('rewriteProfileRefs', () => {
  it('rewrites grid items and prompts of the moved profile only', () => {
    const before = config({
      shortcutGrid: {
        items: [
          { type: 'profileChat', profileId: 'profile-a' },
          {
            type: 'profile',
            profileId: 'profile-a',
            vaultId: 'w',
            action: 'chat',
          },
          { type: 'profileChat', profileId: 'profile-b' },
        ],
      },
      chatPrompts: { items: [{ id: 'p1', profileId: 'profile-a' }] },
      plugins: { x: { settings: { profileId: 'profile-a' } } },
      theme: 'dark',
    })
    const patch = rewriteProfileRefs(before, 'profile-a', 'w:profile-c')
    expect(Object.keys(patch).sort()).toEqual(['chatPrompts', 'shortcutGrid'])
    expect(patch).toEqual({
      shortcutGrid: {
        items: [
          { type: 'profileChat', profileId: 'profile-c', vaultId: 'w' },
          {
            type: 'profile',
            profileId: 'profile-a',
            vaultId: 'w',
            action: 'chat',
          },
          { type: 'profileChat', profileId: 'profile-b' },
        ],
      },
      chatPrompts: {
        items: [{ id: 'p1', profileId: 'profile-c', vaultId: 'w' }],
      },
    })
  })

  it('drops the vault when the profile moves to the main one', () => {
    const before = config({
      chatPrompts: {
        items: [{ id: 'p1', profileId: 'profile-a', vaultId: 'w' }],
      },
    })
    expect(rewriteProfileRefs(before, 'w:profile-a', 'profile-a')).toEqual({
      chatPrompts: { items: [{ id: 'p1', profileId: 'profile-a' }] },
    })
  })

  it('returns nothing when nothing names the profile', () => {
    expect(
      rewriteProfileRefs(config({ chatPrompts: { items: [] } }), 'a', 'b')
    ).toEqual({})
  })
})
