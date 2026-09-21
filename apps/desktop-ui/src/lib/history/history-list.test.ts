import type { EditorHistoryItem } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  filterEditorHistory,
  formatHistoryDateTime,
  formatHistoryTime,
  groupByDay,
  parseHistoryTime,
} from './history-list'

function item(
  id: string,
  kind: EditorHistoryItem['kind'],
  createdAt = 1
): EditorHistoryItem {
  return { id, text: id, kind, createdAt }
}

describe('filterEditorHistory', () => {
  const items = [item('a', 'output'), item('b', 'draft'), item('c', 'source')]

  it('keeps everything for "all"', () => {
    expect(filterEditorHistory(items, 'all')).toBe(items)
  })

  it('keeps one kind', () => {
    expect(filterEditorHistory(items, 'draft').map((i) => i.id)).toEqual(['b'])
  })
})

describe('groupByDay', () => {
  const now = new Date(2026, 8, 21, 15, 0).getTime()
  const at = (day: number, hour: number) =>
    new Date(2026, 8, day, hour, 0).getTime()

  it('names today and yesterday and dates older days', () => {
    const items = [
      item('t1', 'draft', at(21, 14)),
      item('t2', 'draft', at(21, 0)),
      item('y', 'draft', at(20, 23)),
      item('o', 'draft', at(3, 9)),
    ]

    const groups = groupByDay(items, (i) => i.createdAt, now, 'en_US')

    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([
      ['t1', 't2'],
      ['y'],
      ['o'],
    ])
    expect(groups[0]?.labelKey).toBe('history.today')
    expect(groups[1]?.labelKey).toBe('history.yesterday')
    expect(groups[2]?.label).toBe(
      new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(at(3, 9))
    )
  })

  it('puts entries without a time into a group of their own', () => {
    const groups = groupByDay(
      [item('new', 'draft', at(21, 10)), item('legacy', 'draft', 0)],
      (i) => i.createdAt,
      now,
      'en_US'
    )

    expect(groups[1]).toEqual({
      key: 'unknown',
      labelKey: 'history.earlier',
      items: [expect.objectContaining({ id: 'legacy' })],
    })
  })
})

describe('formatHistoryTime', () => {
  it('returns an empty string for an unknown time', () => {
    expect(formatHistoryTime(0, 'en_US')).toBe('')
  })

  it('formats with the app locale', () => {
    const time = Date.UTC(2026, 8, 21, 12, 0)

    expect(formatHistoryTime(time, 'en_US')).toBe(
      new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(time)
    )
  })

  it('survives a locale Intl does not accept', () => {
    expect(formatHistoryTime(Date.UTC(2026, 0, 1), '!!')).not.toBe('')
  })
})

describe('formatHistoryDateTime', () => {
  it('formats a full localized timestamp', () => {
    const time = Date.UTC(2026, 8, 21, 12, 0)

    expect(formatHistoryDateTime(time, 'en_US')).toBe(
      new Intl.DateTimeFormat('en-US', {
        dateStyle: 'long',
        timeStyle: 'medium',
      }).format(time)
    )
  })
})

describe('parseHistoryTime', () => {
  it('parses an ISO date', () => {
    expect(parseHistoryTime('2026-04-22T00:00:00.000Z')).toBe(
      Date.UTC(2026, 3, 22)
    )
  })

  it('returns 0 for a missing or broken date', () => {
    expect(parseHistoryTime(undefined)).toBe(0)
    expect(parseHistoryTime('nope')).toBe(0)
  })
})
