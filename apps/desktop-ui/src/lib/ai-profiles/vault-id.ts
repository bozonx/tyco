import { isIpcErrorCode } from '../ipc/ipc-model'
import { joinRef } from './profile-ref'

const defaultRandomSuffix = () =>
  crypto.randomUUID().replace(/-/g, '').slice(0, 8)

/** How many fresh ids a creation tries before it gives up */
export const MAX_VAULT_ID_ATTEMPTS = 5

/**
 * The folder of a new profile or project: `<kind>-<8 hex>`, never made from the
 * name, so two devices that create a profile of one name before a sync never
 * write into one folder. Taken ids get another suffix.
 */
export function createVaultId(
  kind: 'profile' | 'project',
  takenIds: readonly string[],
  randomSuffix: () => string = defaultRandomSuffix
): string {
  const taken = new Set(takenIds)
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = `${kind}-${randomSuffix()}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`No free ${kind} id`)
}

/**
 * Creates an entity under a fresh id, and under another one when the folder
 * turns out to be taken, e.g. by one a sync has just brought
 */
export async function createWithFreshId<T>(
  kind: 'profile' | 'project',
  takenIds: readonly string[],
  create: (id: string) => Promise<T>,
  randomSuffix?: () => string,
  /** The vault the entity goes to; empty for the main one */
  vaultId = ''
): Promise<T> {
  const taken = [...takenIds]
  for (let attempt = 1; ; attempt++) {
    const id = joinRef(
      vaultId,
      createVaultId(
        kind,
        taken.map((key) => key.slice(key.lastIndexOf(':') + 1)),
        randomSuffix
      )
    )
    try {
      return await create(id)
    } catch (error) {
      if (
        attempt >= MAX_VAULT_ID_ATTEMPTS ||
        !isIpcErrorCode(error, 'alreadyExists')
      )
        throw error
      taken.push(id)
    }
  }
}
