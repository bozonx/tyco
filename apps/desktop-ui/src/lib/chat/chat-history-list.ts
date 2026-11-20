import type { ChatSummary } from '@tyco/shared'

export type ChatHistoryGroup = 'today' | 'yesterday' | 'previousWeek' | 'older'

/**
 * The chats matching the query. The index holds no messages, so the chats whose
 * messages match come as `matchedIds` from a search in storage; until it
 * answers, only the titles are matched
 */
export function filterChatHistory(
  items: ChatSummary[],
  query: string,
  matchedIds?: ReadonlySet<string> | null
) {
  // the same case folding as the search in storage
  const normalized = query.trim().toLowerCase()
  if (!normalized) return items
  return items.filter(
    (item) =>
      matchedIds?.has(item.id) || item.title.toLowerCase().includes(normalized)
  )
}

/** Groups by calendar day of the last message, newest first */
export function groupChatHistory(
  items: ChatSummary[],
  now = Date.now()
): Array<{ key: ChatHistoryGroup; items: ChatSummary[] }> {
  const startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  const startYesterday = new Date(startToday)
  startYesterday.setDate(startYesterday.getDate() - 1)
  const startWeek = new Date(startToday)
  startWeek.setDate(startWeek.getDate() - 7)

  const groups = new Map<ChatHistoryGroup, ChatSummary[]>()
  const sorted = [...items].sort((a, b) => b.lastMessageAt - a.lastMessageAt)

  for (const item of sorted) {
    const time = item.lastMessageAt
    const key: ChatHistoryGroup =
      time >= startToday.getTime()
        ? 'today'
        : time >= startYesterday.getTime()
          ? 'yesterday'
          : time >= startWeek.getTime()
            ? 'previousWeek'
            : 'older'
    const group = groups.get(key) || []
    group.push(item)
    groups.set(key, group)
  }

  return (['today', 'yesterday', 'previousWeek', 'older'] as const)
    .filter((key) => groups.has(key))
    .map((key) => ({ key, items: groups.get(key) || [] }))
}

/**
 * Resolves the update timestamp of a chat: `updatedAt` if present, otherwise
 * `lastMessageAt`.
 */
export function chatUpdatedAt(item: {
  updatedAt?: number
  lastMessageAt?: number
}): number {
  return item.updatedAt ?? item.lastMessageAt ?? 0
}

/** Finds the chat with the most recent `updatedAt` (or `lastMessageAt`). */
export function findCurrentChat<
  T extends { id: string; updatedAt?: number; lastMessageAt?: number },
>(items: readonly T[]): T | null {
  if (!items || items.length === 0) return null
  let latest = items[0]
  let latestTime = chatUpdatedAt(latest)
  for (let i = 1; i < items.length; i++) {
    const time = chatUpdatedAt(items[i])
    if (time > latestTime) {
      latestTime = time
      latest = items[i]
    }
  }
  return latest
}
