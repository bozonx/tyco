import type { VaultInfo } from '@tyco/shared'

import { vaultOfRef } from './profile-ref'

/** The name a vault is shown by; the main one has none of its own */
export function vaultLabel(
  vault: Pick<VaultInfo, 'isMain' | 'name' | 'path'>,
  mainLabel: string
): string {
  if (vault.isMain) return mainLabel
  return (
    vault.name.trim() ||
    vault.path.split(/[\\/]/).filter(Boolean).at(-1) ||
    vault.path
  )
}

export interface VaultGroup<T> {
  vault: VaultInfo
  items: T[]
}

/**
 * The entities of each vault that is there, the main one first; a vault without
 * any is listed too, so that something can be made in it
 */
export function groupByVault<T extends { id: string }>(
  items: readonly T[],
  vaults: readonly VaultInfo[]
): VaultGroup<T>[] {
  return vaults
    .filter((vault) => vault.isMain || vault.status === 'connected')
    .map((vault) => ({
      vault,
      items: items.filter((item) => vaultOfRef(item.id) === vault.vaultId),
    }))
}

/**
 * The name of a profile with its vault when another profile has that name too,
 * so that the two can be told apart
 */
export function entityLabel(
  item: { id: string; name: string },
  all: readonly { id: string; name: string }[],
  vaults: readonly VaultInfo[],
  mainLabel: string
): string {
  const isShared = all.some(
    (other) => other.id !== item.id && other.name.trim() === item.name.trim()
  )
  if (!isShared) return item.name
  const vault = vaults.find((info) => info.vaultId === vaultOfRef(item.id))
  return vault ? `${item.name} (${vaultLabel(vault, mainLabel)})` : item.name
}
