import { MAX_VAULT_ID_LENGTH as MAX_ID_LENGTH } from '@tyco/shared'

const defaultRandomSuffix = () => crypto.randomUUID().slice(0, 8)

/**
 * The folder name of a new profile or project. It comes from the name when the
 * name has Latin letters or digits; otherwise, e.g. for a Cyrillic name, from
 * `fallback` and a random suffix. Taken ids get a counter.
 */
export function createVaultId(
  name: string,
  fallback: string,
  takenIds: readonly string[],
  randomSuffix: () => string = defaultRandomSuffix
): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH - 8)
    .replace(/-+$/, '')
  const base = slug || `${fallback}-${randomSuffix()}`
  const taken = new Set(takenIds)
  let candidate = base
  let counter = 1
  while (taken.has(candidate)) {
    candidate = `${base}-${counter++}`
  }
  return candidate
}
