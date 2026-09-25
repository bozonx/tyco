import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DIFF_VIEW_MODE,
  DIFF_VIEW_MODE_STORAGE_KEY,
  computeSplitDiff,
  computeWordDiff,
  hasDifferences,
  isDiffViewMode,
  readStoredDiffMode,
  writeStoredDiffMode,
} from './diff-model'

describe('diff-model', () => {
  describe('computeWordDiff', () => {
    it('returns empty array when both strings are empty', () => {
      const parts = computeWordDiff('', '')
      expect(parts).toEqual([])
      expect(hasDifferences(parts)).toBe(false)
    })

    it('returns single unchanged part when strings are identical', () => {
      const parts = computeWordDiff('hello world', 'hello world')
      expect(parts).toEqual([{ value: 'hello world' }])
      expect(hasDifferences(parts)).toBe(false)
    })

    it('identifies word-level additions and deletions cleanly without char fragmentation', () => {
      const oldText = 'В задачу лаборатории не входил ямо'
      const newText = 'В подачу лаборатории необходимо'

      const parts = computeWordDiff(oldText, newText)

      expect(hasDifferences(parts)).toBe(true)

      // Words shouldn't be split into individual characters
      const removedValues = parts.filter((p) => p.removed).map((p) => p.value)
      const addedValues = parts.filter((p) => p.added).map((p) => p.value)

      expect(removedValues).toContain('задачу')
      expect(addedValues).toContain('подачу')
      expect(removedValues).toContain('не входил ямо')
      expect(addedValues).toContain('необходимо')

      // Text reconstructed should match
      const reconstructedOld = parts
        .filter((p) => !p.added)
        .map((p) => p.value)
        .join('')
      const reconstructedNew = parts
        .filter((p) => !p.removed)
        .map((p) => p.value)
        .join('')

      expect(reconstructedOld).toBe(oldText)
      expect(reconstructedNew).toBe(newText)
    })

    it('throws when inputs are not strings', () => {
      expect(() => computeWordDiff(null as any, 'test')).toThrow()
      expect(() => computeWordDiff('test', undefined as any)).toThrow()
    })
  })

  describe('computeSplitDiff', () => {
    it('returns old and new parts that reconstruct their respective texts exactly', () => {
      const oldText = 'First line with typos and mistakes.\nSecond line.'
      const newText = 'First line with corrections and fixes.\nSecond line.'

      const { oldParts, newParts } = computeSplitDiff(oldText, newText)

      const fullOld = oldParts.map((p) => p.value).join('')
      const fullNew = newParts.map((p) => p.value).join('')

      expect(fullOld).toBe(oldText)
      expect(fullNew).toBe(newText)

      expect(oldParts.some((p) => p.removed)).toBe(true)
      expect(oldParts.some((p) => p.added)).toBe(false)

      expect(newParts.some((p) => p.added)).toBe(true)
      expect(newParts.some((p) => p.removed)).toBe(false)
    })
  })

  describe('storage persistence', () => {
    class MockStorage implements Storage {
      private store: Record<string, string> = {}
      get length() {
        return Object.keys(this.store).length
      }
      clear() {
        this.store = {}
      }
      getItem(key: string) {
        return this.store[key] ?? null
      }
      key(index: number) {
        return Object.keys(this.store)[index] ?? null
      }
      removeItem(key: string) {
        delete this.store[key]
      }
      setItem(key: string, value: string) {
        this.store[key] = value
      }
    }

    it('reads default mode when storage is empty or invalid', () => {
      const storage = new MockStorage()
      expect(readStoredDiffMode(storage)).toBe(DEFAULT_DIFF_VIEW_MODE)

      storage.setItem(DIFF_VIEW_MODE_STORAGE_KEY, 'invalid-mode')
      expect(readStoredDiffMode(storage)).toBe(DEFAULT_DIFF_VIEW_MODE)
    })

    it('reads and writes valid diff view modes', () => {
      const storage = new MockStorage()

      writeStoredDiffMode('split', storage)
      expect(readStoredDiffMode(storage)).toBe('split')

      writeStoredDiffMode('result', storage)
      expect(readStoredDiffMode(storage)).toBe('result')

      writeStoredDiffMode('unified', storage)
      expect(readStoredDiffMode(storage)).toBe('unified')
    })

    it('validates mode via isDiffViewMode', () => {
      expect(isDiffViewMode('unified')).toBe(true)
      expect(isDiffViewMode('split')).toBe(true)
      expect(isDiffViewMode('result')).toBe(true)
      expect(isDiffViewMode('other')).toBe(false)
      expect(isDiffViewMode(null)).toBe(false)
    })
  })
})
