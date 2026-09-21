import type { ChatHistoryItem } from '@tyco/shared'

export type ChatHistoryGroup = 'today' | 'yesterday' | 'previousWeek' | 'older'

export function filterChatHistory(items: ChatHistoryItem[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return items
  return items.filter((item) =>
    `${item.description}\n${item.messages.map((message) => message.content).join('\n')}`
      .toLocaleLowerCase()
      .includes(normalized)
  )
}

export function groupChatHistory(
  items: ChatHistoryItem[],
  now = Date.now()
): Array<{ key: ChatHistoryGroup; items: ChatHistoryItem[] }> {
  const startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  const day = 86_400_000
  const groups = new Map<ChatHistoryGroup, ChatHistoryItem[]>()

  for (const item of items) {
    const time = Date.parse(item.lastMsgDate)
    const age = startToday.getTime() - time
    const key: ChatHistoryGroup =
      age < day
        ? 'today'
        : age < day * 2
          ? 'yesterday'
          : age < day * 7
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
