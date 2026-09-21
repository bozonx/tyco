import { describe, expect, it } from 'vitest'

import type { ChatHistoryItem } from '@tyco/shared'
import { filterChatHistory, groupChatHistory } from './chat-history-list'

const item = (id: string, date: string, description = id): ChatHistoryItem => ({
  id,
  description,
  lastMsgDate: date,
  messages: [{ role: 'user', content: description }],
})

describe('chat-history-list', () => {
  it('filters titles and message content', () => {
    const items = [item('1', '2026-09-21', 'Release notes')]
    expect(filterChatHistory(items, 'release')).toEqual(items)
    expect(filterChatHistory(items, 'missing')).toEqual([])
  })

  it('groups recent conversations', () => {
    const groups = groupChatHistory(
      [
        item('today', '2026-09-21T12:00:00Z'),
        item('week', '2026-09-17T12:00:00Z'),
      ],
      new Date('2026-09-21T15:00:00Z').getTime()
    )
    expect(groups.map((group) => group.key)).toEqual(['today', 'previousWeek'])
  })
})
