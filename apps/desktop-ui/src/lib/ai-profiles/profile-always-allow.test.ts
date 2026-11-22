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
          tools: {
            sources: {},
            commandIds: [],
            tools: { 'core:files:write_file': 'ask' },
          },
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
      tools: {
        sources: {},
        tools: { 'core:files:write_file': 'allow' },
        commandIds: [],
      },
      projectPermissions: {
        book: { read: 'allow', write: 'allow', delete: 'ask' },
      },
    })
  })

  it('changes nothing for a project no longer connected', () => {
    expect(
      alwaysAllowedProfilePatchOf(profile, [
        { kind: 'project', projectId: 'gone', operations: ['write'] },
      ])
    ).toBeUndefined()
  })
})
