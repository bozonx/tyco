import { describe, expect, it } from 'vitest'

import { IpcCallError } from '../ipc/ipc-model'
import { createWorkspaceId, createWithFreshId } from './workspace-id'

const suffixes = (...values: string[]) => {
  let index = 0
  return () => values[index++ % values.length]
}

describe('createWorkspaceId', () => {
  it('is random and never made from the name', () => {
    expect(createWorkspaceId('profile', [])).toMatch(/^profile-[0-9a-f]{8}$/)
    expect(createWorkspaceId('project', [])).toMatch(/^project-[0-9a-f]{8}$/)
    expect(createWorkspaceId('profile', [])).not.toBe(
      createWorkspaceId('profile', [])
    )
  })

  it('skips taken ids', () => {
    expect(
      createWorkspaceId(
        'profile',
        ['profile-aaaaaaaa'],
        suffixes('aaaaaaaa', 'bbbbbbbb')
      )
    ).toBe('profile-bbbbbbbb')
  })
})

describe('createWithFreshId', () => {
  it('tries another id when the folder turns out to be taken', async () => {
    const tried: string[] = []
    const id = await createWithFreshId(
      'profile',
      [],
      async (candidate) => {
        tried.push(candidate)
        if (tried.length === 1) throw new IpcCallError('taken', 'alreadyExists')
        return candidate
      },
      suffixes('aaaaaaaa', 'bbbbbbbb')
    )
    expect(tried).toEqual(['profile-aaaaaaaa', 'profile-bbbbbbbb'])
    expect(id).toBe('profile-bbbbbbbb')
  })

  it('passes other failures on', async () => {
    let calls = 0
    await expect(
      createWithFreshId('project', [], async () => {
        calls++
        throw new IpcCallError('no', 'invalidInput')
      })
    ).rejects.toThrow('no')
    expect(calls).toBe(1)
  })
})
