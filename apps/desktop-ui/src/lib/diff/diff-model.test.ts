import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DIFF_VIEW_MODE,
  cycleDiffMode,
  cycleParallelViewMode,
  splitDiffParts,
  computeWordDiff,
  hasDifferences,
  isDiffViewMode,
  resolveDiffMode,
  resolveParallelViewMode,
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

  describe('splitDiffParts', () => {
    it('returns old and new parts that reconstruct their respective texts exactly', () => {
      const oldText = 'First line with typos and mistakes.\nSecond line.'
      const newText = 'First line with corrections and fixes.\nSecond line.'

      const { oldParts, newParts } = splitDiffParts(
        computeWordDiff(oldText, newText)
      )

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

  it('resolves and cycles diff and parallel view modes', () => {
    expect(resolveDiffMode()).toBe(DEFAULT_DIFF_VIEW_MODE)
    expect(resolveDiffMode(null)).toBe(DEFAULT_DIFF_VIEW_MODE)
    expect(resolveDiffMode('split')).toBe('split')
    expect(resolveDiffMode('result')).toBe('result')
    expect(isDiffViewMode('other')).toBe(false)

    expect(cycleDiffMode('unified')).toBe('split')
    expect(cycleDiffMode('split')).toBe('result')
    expect(cycleDiffMode('result')).toBe('unified')

    expect(resolveParallelViewMode()).toBe('split')
    expect(resolveParallelViewMode('result')).toBe('result')
    expect(cycleParallelViewMode('split')).toBe('result')
    expect(cycleParallelViewMode('result')).toBe('split')
  })
})
