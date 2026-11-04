import { describe, expect, it } from 'vitest'
import {
  addSnippet,
  filterSnippets,
  isDuplicateSnippet,
  nextSnippetId,
  removeSnippet,
  reorderSnippets,
  snippetPreview,
  updateSnippet,
} from './snippets-model'
import type { SnippetConfig } from '@tyco/shared'

describe('snippets-model', () => {
  const sampleSnippets: SnippetConfig[] = [
    { id: 'snippet-1', text: 'SELECT * FROM users;' },
    { id: 'snippet-2', text: 'Hello, World!\nMultiline snippet' },
    { id: 'snippet-3', text: 'git commit -m "feat: new feature"' },
  ]

  describe('nextSnippetId', () => {
    it('generates next available id with prefix', () => {
      expect(nextSnippetId([])).toBe('snippet-1')
      expect(nextSnippetId([{ id: 'snippet-1' }])).toBe('snippet-2')
      expect(nextSnippetId([{ id: 'snippet-1' }, { id: 'snippet-2' }])).toBe(
        'snippet-3'
      )
    })

    it('skips taken ids', () => {
      expect(nextSnippetId([{ id: 'snippet-1' }, { id: 'snippet-3' }])).toBe(
        'snippet-2'
      )
    })
  })

  describe('isDuplicateSnippet', () => {
    it('detects duplicate text with trimming', () => {
      expect(
        isDuplicateSnippet(sampleSnippets, '  SELECT * FROM users;  ')
      ).toBe(true)
      expect(isDuplicateSnippet(sampleSnippets, 'SELECT * FROM posts;')).toBe(
        false
      )
    })

    it('returns false for empty input', () => {
      expect(isDuplicateSnippet(sampleSnippets, '')).toBe(false)
      expect(isDuplicateSnippet(sampleSnippets, '   ')).toBe(false)
    })
  })

  describe('filterSnippets', () => {
    it('returns all snippets when query is empty', () => {
      expect(filterSnippets(sampleSnippets, '')).toHaveLength(3)
      expect(filterSnippets(sampleSnippets, '   ')).toHaveLength(3)
    })

    it('filters case-insensitively across full text', () => {
      expect(filterSnippets(sampleSnippets, 'select')).toEqual([
        sampleSnippets[0],
      ])
      expect(filterSnippets(sampleSnippets, 'multiline')).toEqual([
        sampleSnippets[1],
      ])
      expect(filterSnippets(sampleSnippets, 'GIT')).toEqual([sampleSnippets[2]])
    })

    it('returns empty array when nothing matches', () => {
      expect(filterSnippets(sampleSnippets, 'nonexistent')).toEqual([])
    })
  })

  describe('addSnippet', () => {
    it('rejects empty text', () => {
      expect(addSnippet(sampleSnippets, '   ')).toEqual({
        success: false,
        reason: 'empty',
      })
    })

    it('rejects duplicate text', () => {
      expect(addSnippet(sampleSnippets, 'SELECT * FROM users;')).toEqual({
        success: false,
        reason: 'duplicate',
      })
    })

    it('prepends new snippet to the front', () => {
      const result = addSnippet(sampleSnippets, 'New snippet text')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.item.id).toBe('snippet-4')
        expect(result.item.text).toBe('New snippet text')
        expect(result.items[0]).toEqual(result.item)
        expect(result.items).toHaveLength(4)
      }
    })
  })

  describe('updateSnippet', () => {
    it('updates text of matching id', () => {
      const updated = updateSnippet(sampleSnippets, 'snippet-2', 'Updated text')
      expect(updated.find((s) => s.id === 'snippet-2')?.text).toBe(
        'Updated text'
      )
      expect(updated.find((s) => s.id === 'snippet-1')?.text).toBe(
        sampleSnippets[0]?.text
      )
    })
  })

  describe('removeSnippet', () => {
    it('removes snippet by id', () => {
      const removed = removeSnippet(sampleSnippets, 'snippet-2')
      expect(removed).toHaveLength(2)
      expect(removed.find((s) => s.id === 'snippet-2')).toBeUndefined()
    })
  })

  describe('reorderSnippets', () => {
    it('moves snippet from one index to another', () => {
      const reordered = reorderSnippets(sampleSnippets, 2, 0)
      expect(reordered[0]?.id).toBe('snippet-3')
      expect(reordered[1]?.id).toBe('snippet-1')
      expect(reordered[2]?.id).toBe('snippet-2')
    })

    it('handles out of bounds gracefully', () => {
      expect(reorderSnippets(sampleSnippets, -1, 1)).toEqual(sampleSnippets)
      expect(reorderSnippets(sampleSnippets, 0, 5)).toEqual(sampleSnippets)
    })
  })

  describe('snippetPreview', () => {
    it('returns first line of snippet', () => {
      expect(snippetPreview('Line 1\nLine 2')).toBe('Line 1')
    })

    it('truncates long lines with ellipsis', () => {
      const long = 'A'.repeat(100)
      const preview = snippetPreview(long, 20)
      expect(preview.length).toBe(20)
      expect(preview.endsWith('…')).toBe(true)
    })
  })
})
