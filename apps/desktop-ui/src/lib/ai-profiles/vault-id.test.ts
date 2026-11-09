import { describe, expect, it } from 'vitest'

import { IpcCallError } from '../ipc/ipc-model'
import { createVaultId, createWithFreshId } from './vault-id'

const suffixes = (...values: string[]) => {
  let index = 0
  return () => values[index++ % values.length]
}

describe('createVaultId', () => {
  it('is random and never made from the name', () => {
    expect(createVaultId('profile', [])).toMatch(/^profile-[0-9a-f]{8}$/)
    expect(createVaultId('project', [])).toMatch(/^project-[0-9a-f]{8}$/)
    expect(createVaultId('profile', [])).not.toBe(createVaultId('profile', []))
  })

  it('skips taken ids', () => {
    expect(
      createVaultId(
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
