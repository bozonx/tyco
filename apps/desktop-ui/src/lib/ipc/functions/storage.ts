import type { StorageKind } from '@tyco/shared'

export interface StorageFunctions {
  getStorageInfo: { args: [] }
  openStorageLocation: { args: [kind: StorageKind] }
  getAiVaultPath: { args: [] }
  openFolderInOs: { args: [path: string] }
}
