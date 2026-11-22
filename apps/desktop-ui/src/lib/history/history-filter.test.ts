import { describe, expect, it } from 'vitest'
import type { EditorHistoryItem } from '@tyco/shared'

import { filterEditorHistory, isProblemHistoryItem } from './history-filter'

const item = (
  id: string,
  patch: Partial<EditorHistoryItem> = {}
): EditorHistoryItem => ({
  id,
  text: id,
  kind: 'draft',
  createdAt: 1,
  isResultApplied: false,
  ...patch,
})

describe('history filter', () => {
  const items = [
    item('typed', { origin: 'quickInput' }),
    item('sent', { origin: 'quickInput', kind: 'output' }),
    item('dictated', { origin: 'voice', kind: 'source', result: 'Dictated.' }),
    item('applied', {
      origin: 'voice',
      kind: 'source',
      result: 'Applied.',
      isResultApplied: true,
    }),
    item('voiceCmd', {
      origin: 'voice',
      kind: 'source',
      operation: 'translation',
      instruction: { text: 'Translate', inputKind: 'voice' },
      result: 'Translated.',
      isResultApplied: true,
    }),
    item('dialogCall', {
      kind: 'dialog',
      dialog: { startedAt: 1, source: 'system' },
    }),
    item('aiResult', {
      kind: 'source',
      operation: 'aiTask',
      result: 'Done.',
      isResultApplied: true,
    }),
    item('failed', {
      kind: 'source',
      operation: 'translation',
      failure: { kind: 'error', message: 'No connection' },
    }),
    item('old'),
  ]
  const ids = (list: EditorHistoryItem[]) => list.map(({ id }) => id)

  it('shows every entry, old ones without an origin too, by default', () => {
    expect(ids(filterEditorHistory(items, 'all'))).toEqual([
      'typed',
      'sent',
      'dictated',
      'applied',
      'voiceCmd',
      'dialogCall',
      'aiResult',
      'failed',
      'old',
    ])
  })

  it('filters by origin, voice command, dialog and operation', () => {
    expect(ids(filterEditorHistory(items, 'quickInput'))).toEqual([
      'typed',
      'sent',
    ])
    expect(ids(filterEditorHistory(items, 'voice'))).toEqual([
      'dictated',
      'applied',
    ])
    expect(ids(filterEditorHistory(items, 'voiceCommands'))).toEqual([
      'voiceCmd',
    ])
    expect(ids(filterEditorHistory(items, 'dialog'))).toEqual(['dialogCall'])
    expect(ids(filterEditorHistory(items, 'translation'))).toEqual([
      'voiceCmd',
      'failed',
    ])
    expect(ids(filterEditorHistory(items, 'aiTask'))).toEqual(['aiResult'])
  })

  it('keeps drafts, failed operations and results that never left the app', () => {
    expect(ids(filterEditorHistory(items, 'problems'))).toEqual([
      'typed',
      'dictated',
      'failed',
      'old',
    ])
    expect(
      isProblemHistoryItem({ kind: 'output', isResultApplied: false })
    ).toBe(false)
  })
})
