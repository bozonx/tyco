import { describe, expect, it } from 'vitest'

import {
  formatEditorHistoryDate,
  getEditorHistoryMeta,
} from './editor-history-meta'

describe('getEditorHistoryMeta', () => {
  it('describes outputs and drafts', () => {
    expect(getEditorHistoryMeta({ kind: 'output' }).labelKey).toBe(
      'history.kindOutput'
    )
    expect(getEditorHistoryMeta({ kind: 'draft' }).labelKey).toBe(
      'history.kindDraft'
    )
  })

  it('names the operation a source was taken before', () => {
    expect(
      getEditorHistoryMeta({ kind: 'source', operation: 'translate' })
    ).toEqual({
      icon: 'mdi:translate',
      labelKey: 'history.kindBeforeTranslate',
    })
    expect(
      getEditorHistoryMeta({ kind: 'source', operation: 'voice-correction' })
        .labelKey
    ).toBe('history.kindVoiceTranscript')
  })

  it('falls back for a source without an operation', () => {
    expect(getEditorHistoryMeta({ kind: 'source' }).labelKey).toBe(
      'history.kindSource'
    )
  })
})

describe('formatEditorHistoryDate', () => {
  it('returns an empty string for an unknown time', () => {
    expect(formatEditorHistoryDate(0, 'en_US')).toBe('')
  })

  it('formats with the app locale', () => {
    const createdAt = Date.UTC(2026, 8, 21, 12, 0)

    expect(formatEditorHistoryDate(createdAt, 'en_US')).toBe(
      new Intl.DateTimeFormat('en-US', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(createdAt)
    )
  })

  it('survives a locale Intl does not accept', () => {
    expect(formatEditorHistoryDate(Date.UTC(2026, 0, 1), '!!')).not.toBe('')
  })
})
