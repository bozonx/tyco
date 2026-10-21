import { shallowRef } from 'vue'

export interface ContributionOwner {
  ownerPluginId?: string
  order?: number
  isRunning?: boolean
}

/** Owns registrations by identity; stale disposers cannot remove replacements. */
export function createContributionRegistry<
  T extends ContributionOwner & { id?: string },
>() {
  const items = shallowRef<T[]>([])
  const list = () =>
    [...items.value].sort((left, right) => {
      const order = (left.order ?? 0) - (right.order ?? 0)
      if (order) return order
      const a = left.ownerPluginId ?? ''
      const b = right.ownerPluginId ?? ''
      return a < b ? -1 : a > b ? 1 : 0
    })
  const register = (entries: T[]) => {
    const next = [...items.value]
    for (const entry of entries) {
      const index = entry.id
        ? next.findIndex((item) => item.id === entry.id)
        : -1
      if (index >= 0) next[index] = entry
      else next.push(entry)
    }
    items.value = next
    return () => {
      const removed = new Set(entries)
      items.value = items.value.filter((item) => !removed.has(item))
    }
  }
  const unregisterPlugin = (id: string) => {
    items.value = items.value.filter((item) => item.ownerPluginId !== id)
  }
  return { items, list, register, unregisterPlugin }
}
