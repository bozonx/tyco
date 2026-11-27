/**
 * Profiles and projects are named by references `[workspaceId:]id`: the
 * workspace part is left out for the main workspace, so its references are the
 * bare ids. Ids never hold the separator
 */
const REF_SEPARATOR = ':'

export interface WorkspaceRef {
  /** Empty for the main workspace */
  workspaceId: string
  id: string
}

export function splitRef(key: string): WorkspaceRef {
  const index = key.indexOf(REF_SEPARATOR)
  return index < 0
    ? { workspaceId: '', id: key }
    : { workspaceId: key.slice(0, index), id: key.slice(index + 1) }
}

export const joinRef = (workspaceId: string, id: string): string =>
  workspaceId ? `${workspaceId}${REF_SEPARATOR}${id}` : id

/** The workspace part of a reference, empty for the main workspace */
export const workspaceOfRef = (key: string): string => splitRef(key).workspaceId

/** A reference to a profile as `config.json` keeps it */
export interface ConfigProfileRef {
  profileId: string
  /** Absent or empty for the main workspace */
  vaultId?: string
}

/** The reference of a profile kept in the settings */
export const configProfileKey = (ref: ConfigProfileRef): string =>
  joinRef(ref.vaultId ?? '', ref.profileId)

/**
 * The fields the settings keep for a profile reference; no workspace for the
 * main one
 */
export function configProfileFields(key: string): ConfigProfileRef {
  const { workspaceId, id } = splitRef(key)
  return workspaceId
    ? { profileId: id, vaultId: workspaceId }
    : { profileId: id }
}
