/** An option of a menu's input mode: a language, a recent request */
export interface QueryOption {
  id: string
  label: string
  /** Other names the option is found by, e.g. its native name and code */
  keywords?: readonly string[]
}

const normalize = (text: string): string => text.trim().toLocaleLowerCase()

/**
 * Options matching `query`: those whose label or keyword starts with it come
 * first, then those containing it, each group in the original order. An empty
 * query keeps all of them.
 */
export function filterOptions<T extends QueryOption>(
  options: readonly T[],
  query: string
): T[] {
  const needle = normalize(query)

  if (!needle) return [...options]

  const prefixed: T[] = []
  const contained: T[] = []

  for (const option of options) {
    const names = [option.label, option.id, ...(option.keywords ?? [])].map(
      normalize
    )

    if (names.some((name) => name.startsWith(needle))) prefixed.push(option)
    else if (names.some((name) => name.includes(needle))) contained.push(option)
  }

  return [...prefixed, ...contained]
}

/**
 * The highlighted index after moving it by `delta` in a list of `length` items,
 * wrapping at the ends. `-1` means nothing is highlighted: moving down from it
 * starts at the top, moving up at the bottom.
 */
export function moveHighlight(
  index: number,
  delta: number,
  length: number
): number {
  if (length <= 0) return -1
  if (index < 0) return delta > 0 ? 0 : length - 1

  return (((index + delta) % length) + length) % length
}

export const RECENT_LIMIT = 10

/** `item` on top of `recent`, without its older copy, at most `limit` long */
export function pushRecent(
  recent: readonly string[] | undefined,
  item: string,
  limit = RECENT_LIMIT
): string[] {
  const value = item.trim()

  if (!value) return [...(recent ?? [])]

  return [value, ...(recent ?? []).filter((entry) => entry !== value)].slice(
    0,
    limit
  )
}

/**
 * `items` with duplicates removed, keeping the first copy: favorites listed in
 * several places show up once, where they are first met
 */
export function uniqueIds<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>()

  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}
