import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  editorHistoryRetentionChoices,
  isEditorHistoryInSession,
} from './editor-history-storage'

describe('isEditorHistoryInSession', () => {
  it('tells the memory-only storage', () => {
    const withStorage = (storage: 'session' | 'disk') => ({
      editor: {
        ...DEFAULT_USER_CONFIG.editor,
        history: { ...DEFAULT_USER_CONFIG.editor.history, storage },
      },
    })
    expect(isEditorHistoryInSession(withStorage('session'))).toBe(true)
    expect(isEditorHistoryInSession(withStorage('disk'))).toBe(false)
  })
})

describe('editorHistoryRetentionChoices', () => {
  it('offers the standard periods', () => {
    expect(editorHistoryRetentionChoices(7)).toEqual([0, 1, 7, 30, 90, 365])
  })

  it('keeps a custom saved period', () => {
    expect(editorHistoryRetentionChoices(14)).toEqual([
      0, 1, 7, 14, 30, 90, 365,
    ])
  })
})
