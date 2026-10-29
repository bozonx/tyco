import {
  validateContribution,
  MAX_CONTRIBUTION_BATCH,
  type PluginDisposer,
} from '@tyco/plugin-sdk'

import type { PluginLifecycle } from './plugin-manager'
import { pluginIconName, pluginMessageKey } from './plugin-resources'

const MAX_TOTAL_CONTRIBUTIONS = 1024

/** Reserves contribution IDs until their owned registration is released. */
export function createPluginRegistration(
  id: string,
  lifecycle: PluginLifecycle,
  check: () => void
) {
  const ids = new Set<string>()
  const key = (value: string) => pluginMessageKey(id, value)!
  function scope<T extends { id?: string; labelKey?: string }>(
    kind: 'action' | 'edit' | 'toolbar' | 'tool',
    items: T[]
  ): T[] {
    check()
    if (
      !Array.isArray(items) ||
      items.length > MAX_CONTRIBUTION_BATCH ||
      ids.size + items.length > MAX_TOTAL_CONTRIBUTIONS
    )
      throw new Error('Too many plugin contributions')
    const next = new Set(ids)
    const result = items.map((item) => {
      validateContribution(item, kind)
      const local = `${kind}:${item.id}`
      if (next.has(local)) throw new Error(`Duplicate ${kind} ID: ${item.id}`)
      next.add(local)
      return {
        ...item,
        ownerPluginId: id,
        id: `${id}:${item.id}`,
        labelKey: item.labelKey ? key(item.labelKey) : undefined,
        icon: pluginIconName(
          id,
          (item as { icon?: string }).icon,
          lifecycle.iconPrefix
        ),
      }
    })
    for (const value of next) ids.add(value)
    return result
  }
  function registration<T extends { id?: string; labelKey?: string }, R>(
    kind: 'action' | 'edit' | 'toolbar' | 'tool',
    items: T[],
    build: (scoped: T[]) => R[],
    register: (items: R[]) => PluginDisposer | void
  ): PluginDisposer {
    const scoped = scope(kind, items)
    const reserved = items.map((item) => `${kind}:${item.id}`)
    const releaseIds = () => {
      for (const localId of reserved) ids.delete(localId)
    }
    try {
      const dispose = register(build(scoped))
      let released = false
      return () => {
        if (released || lifecycle.signal.aborted) return undefined
        released = true
        try {
          const result = dispose?.()
          if (result) return Promise.resolve(result).finally(releaseIds)
          releaseIds()
          return undefined
        } catch (error) {
          releaseIds()
          throw error
        }
      }
    } catch (error) {
      releaseIds()
      throw error
    }
  }
  return registration
}
