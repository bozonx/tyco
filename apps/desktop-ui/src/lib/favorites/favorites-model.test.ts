import { describe, expect, it } from 'vitest'
import {
  addFavorite,
  filterFavorites,
  isDuplicateFavorite,
  nextFavoriteId,
  removeFavorite,
  reorderFavorites,
  favoritePreview,
  updateFavorite,
} from './favorites-model'
import type { FavoriteConfig } from '@tyco/shared'

describe('favorites-model', () => {
  const sampleFavorites: FavoriteConfig[] = [
    { id: 'favorite-1', text: 'SELECT * FROM users;' },
    { id: 'favorite-2', text: 'Hello, World!\nMultiline favorite' },
    { id: 'favorite-3', text: 'git commit -m "feat: new feature"' },
  ]

  describe('nextFavoriteId', () => {
    it('generates next available id with prefix', () => {
      expect(nextFavoriteId([])).toBe('favorite-1')
      expect(nextFavoriteId([{ id: 'favorite-1' }])).toBe('favorite-2')
      expect(nextFavoriteId([{ id: 'favorite-1' }, { id: 'favorite-2' }])).toBe(
        'favorite-3'
      )
    })

    it('skips taken ids', () => {
      expect(nextFavoriteId([{ id: 'favorite-1' }, { id: 'favorite-3' }])).toBe(
        'favorite-2'
      )
    })
  })

  describe('isDuplicateFavorite', () => {
    it('detects duplicate text with trimming', () => {
      expect(
        isDuplicateFavorite(sampleFavorites, '  SELECT * FROM users;  ')
      ).toBe(true)
      expect(isDuplicateFavorite(sampleFavorites, 'SELECT * FROM posts;')).toBe(
        false
      )
    })

    it('returns false for empty input', () => {
      expect(isDuplicateFavorite(sampleFavorites, '')).toBe(false)
      expect(isDuplicateFavorite(sampleFavorites, '   ')).toBe(false)
    })
  })

  describe('filterFavorites', () => {
    it('returns all favorites when query is empty', () => {
      expect(filterFavorites(sampleFavorites, '')).toHaveLength(3)
      expect(filterFavorites(sampleFavorites, '   ')).toHaveLength(3)
    })

    it('filters case-insensitively across full text', () => {
      expect(filterFavorites(sampleFavorites, 'select')).toEqual([
        sampleFavorites[0],
      ])
      expect(filterFavorites(sampleFavorites, 'multiline')).toEqual([
        sampleFavorites[1],
      ])
      expect(filterFavorites(sampleFavorites, 'GIT')).toEqual([
        sampleFavorites[2],
      ])
    })

    it('returns empty array when nothing matches', () => {
      expect(filterFavorites(sampleFavorites, 'nonexistent')).toEqual([])
    })

    it('matches names independently of text, ignoring case', () => {
      const named = { id: 'named', name: 'Greeting', text: 'Hello' }
      expect(filterFavorites([named], 'GREET')).toEqual([named])
      expect(filterFavorites([named], 'hello')).toEqual([named])
    })
  })

  describe('addFavorite', () => {
    it('rejects empty text', () => {
      expect(addFavorite(sampleFavorites, '   ')).toEqual({
        success: false,
        reason: 'empty',
      })
    })

    it('rejects duplicate text', () => {
      expect(addFavorite(sampleFavorites, 'SELECT * FROM users;')).toEqual({
        success: false,
        reason: 'duplicate',
      })
    })

    it('appends new favorite to the end', () => {
      const result = addFavorite(sampleFavorites, 'New favorite text')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.item.id).toBe('favorite-4')
        expect(result.item.text).toBe('New favorite text')
        expect(result.items[3]).toEqual(result.item)
        expect(result.items).toHaveLength(4)
      }
    })
  })

  describe('updateFavorite', () => {
    it('updates text of matching id', () => {
      const updated = updateFavorite(
        sampleFavorites,
        'favorite-2',
        'Updated text'
      )
      expect(updated.find((s) => s.id === 'favorite-2')?.text).toBe(
        'Updated text'
      )
      expect(updated.find((s) => s.id === 'favorite-1')?.text).toBe(
        sampleFavorites[0]?.text
      )
    })
  })

  describe('removeFavorite', () => {
    it('removes favorite by id', () => {
      const removed = removeFavorite(sampleFavorites, 'favorite-2')
      expect(removed).toHaveLength(2)
      expect(removed.find((s) => s.id === 'favorite-2')).toBeUndefined()
    })
  })

  describe('reorderFavorites', () => {
    it('moves favorite from one index to another', () => {
      const reordered = reorderFavorites(sampleFavorites, 2, 0)
      expect(reordered[0]?.id).toBe('favorite-3')
      expect(reordered[1]?.id).toBe('favorite-1')
      expect(reordered[2]?.id).toBe('favorite-2')
    })

    it('handles out of bounds gracefully', () => {
      expect(reorderFavorites(sampleFavorites, -1, 1)).toEqual(sampleFavorites)
      expect(reorderFavorites(sampleFavorites, 0, 5)).toEqual(sampleFavorites)
    })
  })

  describe('favoritePreview', () => {
    it('returns first line of favorite', () => {
      expect(favoritePreview('Line 1\nLine 2')).toBe('Line 1')
    })

    it('truncates long lines with ellipsis', () => {
      const long = 'A'.repeat(100)
      const preview = favoritePreview(long, 20)
      expect(preview.length).toBe(20)
      expect(preview.endsWith('…')).toBe(true)
    })
  })
})
