import type { ChatHistoryItem } from '@tyco/shared'

export type ChatHistoryGroup = 'today' | 'yesterday' | 'previousWeek' | 'older'

/**
 * The chats matching the query. The index holds no messages, so the chats whose
 * messages match come as `matchedIds` from a search in storage; until it
 * answers, only the titles are matched
 */
export function filterChatHistory(
  items: ChatHistoryItem[],
  query: string,
  matchedIds?: ReadonlySet<string> | null
) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return items
  return items.filter(
    (item) =>
      matchedIds?.has(item.id) ||
      item.description.toLocaleLowerCase().includes(normalized)
  )
}

/** Groups by calendar day of the last message, newest first */
export function groupChatHistory(
  items: ChatHistoryItem[],
  now = Date.now()
): Array<{ key: ChatHistoryGroup; items: ChatHistoryItem[] }> {
  const startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  const startYesterday = new Date(startToday)
  startYesterday.setDate(startYesterday.getDate() - 1)
  const startWeek = new Date(startToday)
  startWeek.setDate(startWeek.getDate() - 7)

  const groups = new Map<ChatHistoryGroup, ChatHistoryItem[]>()
  const sorted = [...items].sort(
    (a, b) => timeOf(b.lastMsgDate) - timeOf(a.lastMsgDate)
  )

  for (const item of sorted) {
    const time = timeOf(item.lastMsgDate)
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

function timeOf(date: string): number {
  const time = Date.parse(date)
  return Number.isNaN(time) ? 0 : time
}
