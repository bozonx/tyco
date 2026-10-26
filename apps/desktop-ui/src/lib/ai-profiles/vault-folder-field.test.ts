import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { createVaultFolderField } from './vault-folder-field'

function fixture(taken: string[] = []) {
  const name = ref('')
  const field = createVaultFolderField({
    name: () => name.value,
    fallback: 'profile',
    takenIds: () => taken,
    randomSuffix: () => 'abcdef1234',
  })
  return { name, field }
}

describe('createVaultFolderField', () => {
  it('suggests the folder from the name', () => {
    const { name, field } = fixture(['writer'])
    name.value = 'Writer'
    expect(field.folderId.value).toBe('writer-1')
    name.value = '翻译'
    expect(field.folderId.value).toBe('profile-abcdef12')
    expect(field.errorKey.value).toBeUndefined()
  })

  it('takes a typed folder in its folder form', () => {
    const { name, field } = fixture(['taken'])
    name.value = 'Writer'
    field.typedId.value = 'Мои заметки'
    expect(field.folderId.value).toBe('moi-zametki')
    expect(field.errorKey.value).toBeUndefined()

    field.typedId.value = 'taken'
    expect(field.errorKey.value).toBe('settings.vaultFolderTaken')
    field.typedId.value = '!!!'
    expect(field.errorKey.value).toBe('settings.vaultFolderInvalid')

    field.reset()
    expect(field.folderId.value).toBe('writer')
  })
})
