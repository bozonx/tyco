/**
 * Profiles and projects are named by references `[vaultId:]id`: the vault part
 * is left out for the main vault, so its references are the bare ids. Ids never
 * hold the separator
 */
const REF_SEPARATOR = ':'

export interface VaultRef {
  /** Empty for the main vault */
  vaultId: string
  id: string
}

export function splitRef(key: string): VaultRef {
  const index = key.indexOf(REF_SEPARATOR)
  return index < 0
    ? { vaultId: '', id: key }
    : { vaultId: key.slice(0, index), id: key.slice(index + 1) }
}

export const joinRef = (vaultId: string, id: string): string =>
  vaultId ? `${vaultId}${REF_SEPARATOR}${id}` : id

/** The vault part of a reference, empty for the main vault */
export const vaultOfRef = (key: string): string => splitRef(key).vaultId

/** A reference to a profile as `config.json` keeps it */
export interface ConfigProfileRef {
  profileId: string
  /** Absent or empty for the main vault */
  vaultId?: string
}

/** The reference of a profile kept in the settings */
export const configProfileKey = (ref: ConfigProfileRef): string =>
  joinRef(ref.vaultId ?? '', ref.profileId)

/**
 * The fields the settings keep for a profile reference; no vault for the main
 * one
 */
export function configProfileFields(key: string): ConfigProfileRef {
  const { vaultId, id } = splitRef(key)
  return vaultId ? { profileId: id, vaultId } : { profileId: id }
}
