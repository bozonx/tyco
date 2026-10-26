import { computed, ref } from 'vue'

import { createVaultId, slugifyVaultName } from './vault-id'

export interface VaultFolderFieldOptions {
  /** The name the folder is suggested from */
  name: () => string
  /** `profile` or `project`: the start of an id the name gives none for */
  fallback: string
  takenIds: () => readonly string[]
  randomSuffix?: () => string
}

/**
 * The folder of a new profile or project: suggested from its name until the
 * user types one. It cannot change after creation
 */
export function createVaultFolderField(options: VaultFolderFieldOptions) {
  /** What the user typed; empty for the suggestion */
  const typedId = ref('')
  // one suffix per page, so the suggestion stays put while the name is typed
  const suffix = (options.randomSuffix ?? (() => crypto.randomUUID()))().slice(
    0,
    8
  )

  const suggestedId = computed(() =>
    createVaultId(
      options.name(),
      options.fallback,
      options.takenIds(),
      () => suffix
    )
  )
  const isTyped = computed(() => Boolean(typedId.value.trim()))
  const folderId = computed(() =>
    isTyped.value ? slugifyVaultName(typedId.value) : suggestedId.value
  )
  /** An i18n key of what is wrong with the typed folder */
  const errorKey = computed(() => {
    if (!isTyped.value) return undefined
    if (!folderId.value) return 'settings.vaultFolderInvalid'
    if (options.takenIds().includes(folderId.value))
      return 'settings.vaultFolderTaken'
    return undefined
  })

  const reset = () => {
    typedId.value = ''
  }

  return { typedId, suggestedId, folderId, errorKey, reset }
}
