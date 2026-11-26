import type { DialogSummary } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  filterDialogHistory,
  formatBreakTime,
  formatDialogDuration,
  formatDialogStartTime,
  groupDialogHistory,
} from './dialog-history-list'

const summary = (
  id: string,
  patch: Partial<DialogSummary> = {}
): DialogSummary => ({
  id,
  title: '',
  preview: '',
  startedAt: 1,
  updatedAt: 1,
  source: 'microphoneAndSystem',
  translationTargetLanguage: 'en',
  segmentCount: 1,
  recordingCount: 0,
  durationMs: 0,
  ...patch,
})

describe('dialog-history-list', () => {
  it('filters by title, preview, and backend-matched ids', () => {
    const items = [
      summary('1', { title: 'Weekly sync', preview: 'hello' }),
      summary('2', { title: '', preview: 'budget review' }),
      summary('3', { title: 'Other', preview: 'unrelated' }),
    ]

    expect(filterDialogHistory(items, '').map((item) => item.id)).toEqual([
      '1',
      '2',
      '3',
    ])
    expect(filterDialogHistory(items, 'budget').map((item) => item.id)).toEqual(
      ['2']
    )
    expect(
      filterDialogHistory(items, 'keyword', new Set(['3'])).map(
        (item) => item.id
      )
    ).toEqual(['3'])
  })

  it('groups dialogs by calendar day newest first', () => {
    const now = new Date(2026, 10, 25, 14, 0, 0).getTime()
    const todayEarly = new Date(2026, 10, 25, 9, 0, 0).getTime()
    const todayLate = new Date(2026, 10, 25, 12, 0, 0).getTime()
    const yesterday = new Date(2026, 10, 24, 15, 0, 0).getTime()
    const lastWeek = new Date(2026, 10, 20, 15, 0, 0).getTime()
    const older = new Date(2026, 10, 1, 15, 0, 0).getTime()

    const groups = groupDialogHistory(
      [
        summary('older', { startedAt: older, updatedAt: older }),
        summary('todayEarly', { startedAt: todayEarly, updatedAt: todayEarly }),
        summary('yesterday', { startedAt: yesterday, updatedAt: yesterday }),
        summary('todayLate', { startedAt: todayLate, updatedAt: todayLate }),
        summary('lastWeek', { startedAt: lastWeek, updatedAt: lastWeek }),
      ],
      now
    )

    expect(
      groups.map((group) => ({
        key: group.key,
        ids: group.items.map((item) => item.id),
      }))
    ).toEqual([
      { key: 'today', ids: ['todayLate', 'todayEarly'] },
      { key: 'yesterday', ids: ['yesterday'] },
      { key: 'previousWeek', ids: ['lastWeek'] },
      { key: 'older', ids: ['older'] },
    ])
  })

  it('formats break timestamps with relative days for past days', () => {
    const now = new Date(2026, 10, 26, 11, 0, 0).getTime()
    const todayMs = new Date(2026, 10, 26, 9, 30, 0).getTime()
    const yesterdayMs = new Date(2026, 10, 25, 9, 30, 0).getTime()
    const twoDaysAgoMs = new Date(2026, 10, 24, 9, 30, 0).getTime()

    expect(formatBreakTime(todayMs, 'ru-RU', now)).toMatch(/9:30|09:30/)
    expect(formatBreakTime(yesterdayMs, 'ru-RU', now)).toMatch(
      /вчера в (9:30|09:30)/
    )
    expect(formatBreakTime(twoDaysAgoMs, 'ru-RU', now)).toMatch(
      /позавчера в (9:30|09:30)/
    )
    expect(formatBreakTime(yesterdayMs, 'en-US', now)).toMatch(
      /yesterday at (9:30|09:30) AM/
    )
  })

  it('formats durations in human-readable localized format', () => {
    expect(formatDialogDuration(0, 'en-US')).toBe('0 sec')
    expect(formatDialogDuration(45_000, 'en-US')).toBe('45 sec')
    expect(formatDialogDuration(65_000, 'en-US')).toBe('1 min')
    expect(formatDialogDuration(3_661_000, 'en-US')).toBe('1 hr 1 min')
    expect(formatDialogDuration(3_600_000, 'en-US')).toBe('1 hr')
  })

  it('formats start time with system clock preference', () => {
    const epochMs = new Date(2026, 10, 20, 9, 3, 40).getTime()
    const formatted = formatDialogStartTime(epochMs)
    expect(formatted).toMatch(/9:03|09:03/)
  })
})
