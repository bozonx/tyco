import { describe, expect, it } from 'vitest'

import {
  editorHistoryRetentionChoices,
  isEditorHistoryOff,
  normalizeEditorConfig,
  resolveEditorHistoryStorage,
} from './editor-history-storage'

describe('resolveEditorHistoryStorage', () => {
  it('keeps a valid saved value', () => {
    expect(
      resolveEditorHistoryStorage({
        editorHistoryStorage: 'session',
        editorHistoryMaxItems: 0,
      })
    ).toBe('session')
  })

  it('derives the storage from the legacy settings', () => {
    expect(resolveEditorHistoryStorage({ editorHistoryMaxItems: 0 })).toBe(
      'off'
    )
    expect(resolveEditorHistoryStorage({ editorHistoryMaxItems: '0' })).toBe(
      'off'
    )
    expect(
      resolveEditorHistoryStorage({
        editorHistoryMaxItems: 20,
        clearEditorHistoryOnExit: true,
      })
    ).toBe('session')
    expect(resolveEditorHistoryStorage({})).toBe('disk')
    expect(resolveEditorHistoryStorage({ editorHistoryStorage: 'cloud' })).toBe(
      'disk'
    )
  })
})

describe('isEditorHistoryOff', () => {
  it('is off by the storage or by a zero limit', () => {
    expect(isEditorHistoryOff({ editorHistoryStorage: 'off' })).toBe(true)
    expect(
      isEditorHistoryOff({
        editorHistoryStorage: 'disk',
        editorHistoryMaxItems: 0,
      })
    ).toBe(true)
    expect(
      isEditorHistoryOff({
        editorHistoryStorage: 'session',
        editorHistoryMaxItems: 10,
      })
    ).toBe(false)
  })
})

describe('normalizeEditorConfig', () => {
  it('replaces the legacy keys', () => {
    const config: Record<string, unknown> = {
      editorHistoryMaxItems: 30,
      clearEditorHistoryOnExit: true,
      pasteMode: 'ask',
      editorSyntax: 'none',
    }

    normalizeEditorConfig(config)

    expect(config).toEqual({
      editorHistoryMaxItems: 30,
      editorHistoryStorage: 'session',
    })
  })

  it('turns a zero limit into the off storage with a usable limit', () => {
    const config: Record<string, unknown> = { editorHistoryMaxItems: 0 }

    normalizeEditorConfig(config)

    expect(config).toEqual({
      editorHistoryMaxItems: 1000,
      editorHistoryStorage: 'off',
    })
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
