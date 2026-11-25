import { describe, expect, it } from 'vitest'

import {
  getEditorHistoryMeta,
  getEditorHistoryNote,
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

  it('falls back for a source without an operation and labels voice commands', () => {
    expect(getEditorHistoryMeta({ kind: 'source' }).labelKey).toBe(
      'history.kindSource'
    )
    expect(
      getEditorHistoryMeta({
        kind: 'draft',
        instruction: { text: '', inputKind: 'voice' },
      })
    ).toEqual({ icon: 'mdi:microphone', labelKey: 'commands.badgeVoice' })
    expect(
      getEditorHistoryMeta({
        kind: 'source',
        instruction: { text: 'Run script', inputKind: 'voice' },
      })
    ).toEqual({ icon: 'mdi:microphone', labelKey: 'commands.badgeVoice' })
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

  it('tells the answer of a quick request inserted or copied', () => {
    expect(
      getEditorHistoryMeta({ kind: 'output', origin: 'quickAiRequest' })
    ).toEqual({
      icon: 'mdi:auto-fix',
      labelKey: 'history.kindQuickAiRequestOutput',
    })
  })
})

describe('getEditorHistoryNote', () => {
  it('returns undefined for applied items and outputs', () => {
    expect(getEditorHistoryNote({ kind: 'output' })).toBeUndefined()

    expect(
      getEditorHistoryNote({
        kind: 'source',
        result: 'Result',
        isResultApplied: true,
      })
    ).toBeUndefined()
  })

  it('marks drafts as interrupted in red', () => {
    expect(getEditorHistoryNote({ kind: 'draft' })).toEqual({
      labelKey: 'history.interrupted',
      tone: 'error',
      icon: 'mdi:alert-circle-outline',
    })
  })

  it('tells why an AI request produced nothing', () => {
    expect(
      getEditorHistoryNote({
        kind: 'source',
        operation: 'translation',
        failure: { kind: 'error', message: 'No connection' },
      })
    ).toEqual({
      labelKey: 'history.requestFailed',
      tone: 'error',
      icon: 'mdi:alert-circle-outline',
      detail: 'No connection',
    })
    expect(
      getEditorHistoryNote({
        kind: 'source',
        operation: 'voiceCorrection',
        failure: { kind: 'timeout' },
      })?.labelKey
    ).toBe('history.requestTimedOut')
    expect(
      getEditorHistoryNote({
        kind: 'source',
        operation: 'aiTask',
        failure: { kind: 'cancelled' },
      })
    ).toEqual({
      labelKey: 'history.requestCancelled',
      tone: 'error',
      icon: 'mdi:cancel',
    })
  })

  it('marks failed or cancelled AI requests in red', () => {
    expect(
      getEditorHistoryNote({ kind: 'source', operation: 'aiTask' })
    ).toEqual({
      labelKey: 'history.requestFailed',
      tone: 'error',
      icon: 'mdi:alert-circle-outline',
    })

    expect(
      getEditorHistoryNote({ kind: 'source', operation: 'voiceCorrection' })
    ).toEqual({
      labelKey: 'history.interrupted',
      tone: 'error',
      icon: 'mdi:alert-circle-outline',
    })
  })

  it('does not mark unapplied results', () => {
    expect(
      getEditorHistoryNote({
        kind: 'source',
        operation: 'translation',
        result: 'Hola',
        isResultApplied: false,
      })
    ).toBeUndefined()
  })
})

describe('finished transcripts', () => {
  it('names a dictation and a listening without marking them interrupted', () => {
    expect(
      getEditorHistoryMeta({ kind: 'transcript', origin: 'voice' }).labelKey
    ).toBe('history.kindVoiceInput')
    expect(
      getEditorHistoryMeta({ kind: 'transcript', origin: 'listen' }).labelKey
    ).toBe('history.filterListen')
    expect(getEditorHistoryNote({ kind: 'transcript' })).toBeUndefined()
  })

  it('keeps the failure of an operation whose text was used as it was', () => {
    expect(
      getEditorHistoryNote({
        kind: 'source',
        operation: 'voiceCorrection',
        isResultApplied: true,
        failure: { kind: 'error', message: 'Offline' },
      })
    ).toMatchObject({ labelKey: 'history.requestFailed', detail: 'Offline' })
  })
})
