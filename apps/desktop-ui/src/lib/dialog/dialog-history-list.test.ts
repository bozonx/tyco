import type { DialogSummary } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  filterDialogHistory,
  formatDialogDuration,
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
        summary('older', { updatedAt: older }),
        summary('todayEarly', { updatedAt: todayEarly }),
        summary('yesterday', { updatedAt: yesterday }),
        summary('todayLate', { updatedAt: todayLate }),
        summary('lastWeek', { updatedAt: lastWeek }),
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

  it('formats durations as M:SS or H:MM:SS', () => {
    expect(formatDialogDuration(0)).toBe('0:00')
    expect(formatDialogDuration(65_000)).toBe('1:05')
    expect(formatDialogDuration(3_661_000)).toBe('1:01:01')
  })
})
