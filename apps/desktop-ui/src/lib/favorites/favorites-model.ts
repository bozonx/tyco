import type { FavoriteConfig } from '@tyco/shared'

const ID_PREFIX = 'favorite'

/** Finds next unique favorite id formatted as `favorite-<n>`. */
export function nextFavoriteId(existing: readonly { id: string }[]): string {
  const ids = new Set(existing.map((item) => item.id))
  let count = 1
  while (ids.has(`${ID_PREFIX}-${count}`)) {
    count += 1
  }
  return `${ID_PREFIX}-${count}`
}

/** Checks whether an identical favorite already exists (trimmed comparison). */
export function isDuplicateFavorite(
  favorites: readonly FavoriteConfig[],
  text: string
): boolean {
  const target = text.trim()
  if (!target) return false
  return favorites.some((item) => item.text.trim() === target)
}

/** Filters favorites by query matching against the full text (case-insensitive). */
export function filterFavorites(
  favorites: readonly FavoriteConfig[],
  query: string
): FavoriteConfig[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return [...favorites]
  }
  return favorites.filter((item) =>
    item.text.toLowerCase().includes(normalizedQuery) ||
    (item.name ?? '').toLowerCase().includes(normalizedQuery)
  )
}

export type AddFavoriteResult =
  | { success: true; item: FavoriteConfig; items: FavoriteConfig[] }
  | { success: false; reason: 'empty' | 'duplicate' }

/** Appends a new favorite to the list if valid and non-duplicate. */
export function addFavorite(
  favorites: readonly FavoriteConfig[],
  text: string
): AddFavoriteResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { success: false, reason: 'empty' }
  }
  if (isDuplicateFavorite(favorites, trimmed)) {
    return { success: false, reason: 'duplicate' }
  }
  const item: FavoriteConfig = { id: nextFavoriteId(favorites), text }
  return { success: true, item, items: [...favorites, item] }
}

/** Updates the text of an existing favorite. */
export function updateFavorite(
  favorites: readonly FavoriteConfig[],
  id: string,
  text: string
): FavoriteConfig[] {
  return favorites.map((item) => (item.id === id ? { ...item, text } : item))
}

/** Removes a favorite by id. */
export function removeFavorite(
  favorites: readonly FavoriteConfig[],
  id: string
): FavoriteConfig[] {
  return favorites.filter((item) => item.id !== id)
}

/** Moves a favorite from one index to another (drag-and-drop reordering). */
export function reorderFavorites(
  favorites: readonly FavoriteConfig[],
  fromIndex: number,
  toIndex: number
): FavoriteConfig[] {
  if (
    fromIndex < 0 ||
    fromIndex >= favorites.length ||
    toIndex < 0 ||
    toIndex >= favorites.length ||
    fromIndex === toIndex
  ) {
    return [...favorites]
  }
  const result = [...favorites]
  const [removed] = result.splice(fromIndex, 1)
  if (removed) {
    result.splice(toIndex, 0, removed)
  }
  return result
}

/** Returns a short single-line preview of the favorite text. */
export function favoritePreview(text: string, maxLength = 80): string {
  const firstLine = text.trim().split('\n')[0]?.trim() ?? ''
  if (firstLine.length <= maxLength) {
    return firstLine
  }
  return `${firstLine.slice(0, maxLength - 1).trimEnd()}…`
}
