import { describe, expect, it } from 'vitest'

import { createVaultId } from './vault-id'

describe('createVaultId', () => {
  it('takes the id from a Latin name', () => {
    expect(createVaultId('Code Reviewer!', 'profile', [])).toBe('code-reviewer')
  })

  it('counts up past taken ids', () => {
    expect(
      createVaultId('Writer', 'profile', ['writer', 'writer-1'], () => 'x')
    ).toBe('writer-2')
  })

  it('gives a name without Latin letters a random id', () => {
    expect(
      createVaultId('Технический писатель', 'profile', [], () => 'a1b2c3d4')
    ).toBe('profile-a1b2c3d4')
  })

  it('keeps a long name within the id limit', () => {
    const id = createVaultId('a'.repeat(100), 'profile', [])
    expect(id.length).toBeLessThanOrEqual(56)
    expect(id).toMatch(/^[a-z0-9_-]+$/)
  })
})
