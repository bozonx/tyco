import type { UserConfig } from '@tyco/shared'

import { configProfileFields, configProfileKey } from './profile-ref'

/** Sections whose content belongs to plugins and is never rewritten */
const OPAQUE_SECTIONS = new Set(['plugins'])

function rewrite(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) {
    let changed = false
    const items = value.map((item) => {
      const next = rewrite(item, from, to)
      if (next !== item) changed = true
      return next
    })
    return changed ? items : value
  }
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  let result: Record<string, unknown> | null = null
  if (
    typeof object.profileId === 'string' &&
    object.profileId &&
    configProfileKey({
      profileId: object.profileId,
      vaultId: typeof object.vaultId === 'string' ? object.vaultId : undefined,
    }) === from
  ) {
    const { vaultId: _vaultId, ...rest } = object
    result = { ...rest, ...configProfileFields(to) }
  }
  for (const [key, child] of Object.entries(object)) {
    if (key === 'profileId' || key === 'vaultId') continue
    const next = rewrite(child, from, to)
    if (next !== child) {
      result ??= { ...object }
      result[key] = next
    }
  }
  return result ?? value
}

/**
 * The sections of `config` that name the profile `from` (a reference
 * `[vaultId:]id`), rewritten to name `to`: grid items, prompts and every other
 * `profileId` with its `vaultId`. Empty when nothing names it
 */
export function rewriteProfileRefs(
  config: UserConfig,
  from: string,
  to: string
): Partial<UserConfig> {
  const patch: Record<string, unknown> = {}
  if (from === to) return patch
  for (const [key, section] of Object.entries(config)) {
    if (OPAQUE_SECTIONS.has(key)) continue
    const next = rewrite(section, from, to)
    if (next !== section) patch[key] = next
  }
  return patch as Partial<UserConfig>
}
