/** What a storage location holds; history and chats are data. */
export type StorageKind = 'config' | 'data' | 'cache' | 'logs'

/**
 * A root directory of the app's files. The platform may put several kinds into
 * one directory, e.g. the config and the data into `%APPDATA%` on Windows.
 */
export interface StorageLocation {
  kinds: StorageKind[]
  path: string
}

export interface StorageInfo {
  locations: StorageLocation[]
}
