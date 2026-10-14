import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  editorHistoryRetentionChoices,
  isEditorHistoryOff,
} from './editor-history-storage'

describe('isEditorHistoryOff', () => {
  it('is off by the storage or by a zero limit', () => {
    expect(
      isEditorHistoryOff({
        editorHistory: { ...DEFAULT_USER_CONFIG.editorHistory, storage: 'off' },
      })
    ).toBe(true)
    expect(
      isEditorHistoryOff({
        editorHistory: {
          ...DEFAULT_USER_CONFIG.editorHistory,
          storage: 'disk',
          maxItems: 0,
        },
      })
    ).toBe(true)
    expect(
      isEditorHistoryOff({
        editorHistory: {
          ...DEFAULT_USER_CONFIG.editorHistory,
          storage: 'session',
          maxItems: 10,
        },
      })
    ).toBe(false)
  })
})

describe('editorHistoryRetentionChoices', () => {
  it('offers the standard periods', () => {
    expect(editorHistoryRetentionChoices(7)).toEqual([0, 1, 7, 30, 90])
  })

  it('keeps a custom saved period', () => {
    expect(editorHistoryRetentionChoices(14)).toEqual([0, 1, 7, 14, 30, 90])
  })
})
