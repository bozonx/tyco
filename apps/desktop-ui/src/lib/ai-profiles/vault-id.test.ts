import { describe, expect, it } from 'vitest'

import { createVaultId, slugifyVaultName } from './vault-id'

describe('createVaultId', () => {
  it('takes the id from a Latin name', () => {
    expect(createVaultId('Code Reviewer!', 'profile', [])).toBe('code-reviewer')
  })

  it('counts up past taken ids', () => {
    expect(
      createVaultId('Writer', 'profile', ['writer', 'writer-1'], () => 'x')
    ).toBe('writer-2')
  })

  it('spells other alphabets in Latin letters', () => {
    expect(createVaultId('Технический писатель', 'profile', [])).toBe(
      'tekhnicheskiy-pisatel'
    )
    expect(slugifyVaultName('Мой помощник №1')).toBe('moy-pomoshchnik-1')
    expect(slugifyVaultName('Їжак і ґанок')).toBe('yizhak-i-ganok')
    expect(slugifyVaultName('Çeviri Yardımcısı')).toBe('ceviri-yardimcisi')
    expect(slugifyVaultName('Español: corrección')).toBe('espanol-correccion')
    expect(slugifyVaultName('Straße')).toBe('strasse')
    expect(slugifyVaultName('Βοηθός')).toBe('voithos')
    expect(slugifyVaultName('თარჯიმანი')).toBe('tarjimani')
  })

  it('gives a name with no Latin spelling a random id', () => {
    expect(createVaultId('翻译助手', 'profile', [], () => 'a1b2c3d4')).toBe(
      'profile-a1b2c3d4'
    )
  })

  it('keeps a long name within the id limit', () => {
    const id = createVaultId('a'.repeat(100), 'profile', [])
    expect(id.length).toBeLessThanOrEqual(56)
    expect(id).toMatch(/^[a-z0-9_-]+$/)
  })
})
