import { describe, expect, it } from 'vitest'

import type { ChatHistoryItem } from '@tyco/shared'
import { filterChatHistory, groupChatHistory } from './chat-history-list'

const item = (id: string, date: string, description = id): ChatHistoryItem => ({
  id,
  description,
  lastMsgDate: date,
  messages: [],
})

describe('chat-history-list', () => {
  it('filters titles, and the chats found in storage', () => {
    const items = [
      item('1', '2026-09-21', 'Release notes'),
      item('2', '2026-09-21', 'Groceries'),
    ]
    expect(filterChatHistory(items, ' release ')).toEqual([items[0]])
    expect(filterChatHistory(items, 'milk', new Set(['2']))).toEqual([items[1]])
    expect(filterChatHistory(items, 'missing')).toEqual([])
    expect(filterChatHistory(items, '')).toEqual(items)
  })

  it('groups by calendar day', () => {
    const now = new Date(2026, 8, 21, 1, 0).getTime()
    const groups = groupChatHistory(
      [
        item('week', new Date(2026, 8, 17, 12).toISOString()),
        item('yesterday', new Date(2026, 8, 20, 23).toISOString()),
        item('today', new Date(2026, 8, 21, 0, 30).toISOString()),
        item('old', new Date(2026, 7, 1).toISOString()),
      ],
      now
    )
    expect(
      groups.map((group) => [group.key, group.items.map((chat) => chat.id)])
    ).toEqual([
      ['today', ['today']],
      ['yesterday', ['yesterday']],
      ['previousWeek', ['week']],
      ['older', ['old']],
    ])
  })

  it('orders each group by the last message, newest first', () => {
    const now = new Date(2026, 8, 21, 18).getTime()
    const [today] = groupChatHistory(
      [
        item('morning', new Date(2026, 8, 21, 9).toISOString()),
        item('noon', new Date(2026, 8, 21, 12).toISOString()),
      ],
      now
    )
    expect(today.items.map((chat) => chat.id)).toEqual(['noon', 'morning'])
  })
})
