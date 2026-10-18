import { describe, expect, it } from 'vitest'

import {
  getEditorHistoryMeta,
  getEditorHistoryView,
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

  it('names the operation that produced a result', () => {
    expect(
      getEditorHistoryMeta({
        kind: 'source',
        operation: 'translation',
        result: 'Hola',
      })
    ).toEqual({ icon: 'mdi:translate', labelKey: 'history.kindTranslate' })
  })

  it('names the operation a source without a result was taken before', () => {
    expect(
      getEditorHistoryMeta({ kind: 'source', operation: 'translation' })
    ).toEqual({
      icon: 'mdi:translate',
      labelKey: 'history.kindBeforeTranslate',
    })
    expect(
      getEditorHistoryMeta({ kind: 'source', operation: 'voiceCorrection' })
        .labelKey
    ).toBe('history.kindVoiceTranscript')
  })

  it('falls back for a source without an operation', () => {
    expect(getEditorHistoryMeta({ kind: 'source' }).labelKey).toBe(
      'history.kindSource'
    )
  })
})

describe('getEditorHistoryView', () => {
  it('leads an AI entry with its result and keeps the original', () => {
    expect(
      getEditorHistoryView({
        kind: 'source',
        operation: 'correction',
        text: 'helo',
        result: 'Hello.',
        isResultApplied: true,
      })
    ).toEqual({
      icon: 'mdi:spellcheck',
      labelKey: 'history.kindCorrection',
      text: 'Hello.',
      original: { labelKey: 'history.original', text: 'helo' },
      isResultApplied: true,
    })
  })

  it('calls the original of a voice entry a transcript', () => {
    expect(
      getEditorHistoryView({
        kind: 'source',
        operation: 'voiceCorrection',
        text: 'raw',
        result: 'Raw.',
      }).original?.labelKey
    ).toBe('history.originalTranscript')
  })

  it('shows a source without a result as is', () => {
    const view = getEditorHistoryView({
      kind: 'source',
      operation: 'aiTask',
      text: 'text',
    })

    expect(view.text).toBe('text')
    expect(view.original).toBeUndefined()
    expect(view.isResultApplied).toBe(false)
  })

  it('shows drafts and outputs as is', () => {
    const view = getEditorHistoryView({ kind: 'draft', text: 'text' })

    expect(view).toMatchObject({ text: 'text', isResultApplied: false })
    expect(view.original).toBeUndefined()
  })
})
