import { describe, expect, it } from 'vitest'
import type { EditorHistoryItem } from '@tyco/shared'

import { filterEditorHistory, isUnsentHistoryItem } from './history-filter'

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
    item('old'),
  ]
  const ids = (list: EditorHistoryItem[]) => list.map(({ id }) => id)

  it('shows every entry, old ones without an origin too, by default', () => {
    expect(
      ids(filterEditorHistory(items, { origin: 'all', isUnsentOnly: false }))
    ).toEqual(['typed', 'sent', 'dictated', 'applied', 'old'])
  })

  it('filters by origin', () => {
    expect(
      ids(
        filterEditorHistory(items, {
          origin: 'quickInput',
          isUnsentOnly: false,
        })
      )
    ).toEqual(['typed', 'sent'])
    expect(
      ids(filterEditorHistory(items, { origin: 'voice', isUnsentOnly: false }))
    ).toEqual(['dictated', 'applied'])
  })

  it('keeps only the texts that never left the app', () => {
    expect(
      ids(filterEditorHistory(items, { origin: 'all', isUnsentOnly: true }))
    ).toEqual(['typed', 'dictated', 'old'])
    expect(
      isUnsentHistoryItem({ kind: 'output', isResultApplied: false })
    ).toBe(false)
  })
})
