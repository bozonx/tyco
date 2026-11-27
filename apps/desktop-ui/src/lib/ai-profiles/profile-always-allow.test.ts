import { describe, expect, it } from 'vitest'

import type { AiProfile } from '@tyco/shared'

import { alwaysAllowedProfilePatchOf } from './profile-always-allow'

describe('alwaysAllowedProfilePatchOf', () => {
  const profile: Pick<AiProfile, 'tools' | 'projectPermissions'> = {
    tools: { sources: {}, tools: {}, commandIds: [] },
    projectPermissions: {
      book: { read: 'allow', write: 'ask', delete: 'ask' },
    },
  }

  it('raises the tool and the project together', () => {
    expect(
      alwaysAllowedProfilePatchOf(
        {
          ...profile,
          tools: { sources: {}, tools: { 'core:files:write_file': 'ask' } },
        },
        [
          {
            kind: 'tool',
            source: { kind: 'core', id: 'files' },
            toolName: 'write_file',
          },
          { kind: 'project', projectId: 'book', operations: ['write'] },
        ]
      )
    ).toEqual({
      tools: { sources: {}, tools: { 'core:files:write_file': 'allow' } },
      projectPermissions: {
        book: { read: 'allow', write: 'allow', delete: 'ask' },
      },
    })
  })

  it('raises the default access of a project the profile sets nothing for', () => {
    expect(
      alwaysAllowedProfilePatchOf(profile, [
        { kind: 'project', projectId: 'other', operations: ['write'] },
      ])?.projectPermissions?.other
    ).toEqual({ read: 'allow', write: 'allow', delete: 'ask' })
  })

  it('changes nothing for a project the profile has no access to', () => {
    const denied = {
      ...profile,
      projectPermissions: {
        closed: { read: 'deny', write: 'deny', delete: 'deny' },
      } as const,
    }
    expect(
      alwaysAllowedProfilePatchOf(denied, [
        { kind: 'project', projectId: 'closed', operations: ['write'] },
      ])
    ).toBeUndefined()
  })
})
