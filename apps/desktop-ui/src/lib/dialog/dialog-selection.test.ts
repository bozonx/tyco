import { describe, expect, it } from 'vitest'

import {
  formatSelectedTurns,
  getTurnContent,
  getTurnRange,
  selectRangeUpTo,
  toggleShiftTurnSelection,
  toggleSingleTurnSelection,
} from './dialog-selection'
import type { DialogTurn } from './dialog-transcript'

function createTurn(
  id: string,
  side: 'me' | 'remote',
  text: string,
  translation?: string,
  startMs = 1700000000000
): DialogTurn {
  return {
    id,
    side,
    startMs,
    endMs: startMs + 1000,
    segments: [
      {
        id: `seg-${id}`,
        side,
        startMs,
        endMs: startMs + 1000,
        text,
        isFinal: true,
        translation,
        translationState: translation ? 'complete' : 'idle',
      },
    ],
  }
}

describe('dialog-selection', () => {
  const turns: DialogTurn[] = [
    createTurn('1', 'remote', 'Hello world', 'Привет мир', 1700000000000),
    createTurn('2', 'me', 'Hi there', undefined, 1700000005000),
    createTurn('3', 'remote', 'How are you?', 'Как дела?', 1700000010000),
    createTurn('4', 'me', 'All good', undefined, 1700000015000),
  ]

  const options = {
    includeMe: true,
    useTranslation: false,
    labels: { me: 'Я', remote: 'Собеседник' },
    formatTime: () => '12:00:00',
  }

  describe('getTurnContent', () => {
    it('returns original text when useTranslation is false', () => {
      expect(getTurnContent(turns[0], false)).toBe('Hello world')
    })

    it('returns translation when useTranslation is true and available', () => {
      expect(getTurnContent(turns[0], true)).toBe('Привет мир')
    })

    it('falls back to original text when translation is empty', () => {
      expect(getTurnContent(turns[1], true)).toBe('Hi there')
    })
  })

  describe('formatSelectedTurns', () => {
    it('returns plain text for single turn', () => {
      const result = formatSelectedTurns([turns[0]], options)
      expect(result).toBe('Hello world')
    })

    it('returns translated text for single turn when translation enabled', () => {
      const result = formatSelectedTurns([turns[0]], {
        ...options,
        useTranslation: true,
      })
      expect(result).toBe('Привет мир')
    })

    it('returns speaker-attributed lines when multiple speakers are present', () => {
      const result = formatSelectedTurns(turns.slice(0, 2), options)
      expect(result).toBe(
        '[12:00:00] Собеседник: Hello world\n[12:00:00] Я: Hi there'
      )
    })

    it('omits redundant speaker labels when only remote speaker turns are selected', () => {
      const result = formatSelectedTurns(turns.slice(0, 3), {
        ...options,
        includeMe: false,
      })
      expect(result).toBe('[12:00:00] Hello world\n[12:00:00] How are you?')
    })

    it('returns plain text if filtering leaves only one turn', () => {
      const result = formatSelectedTurns(turns.slice(0, 2), {
        ...options,
        includeMe: false,
      })
      expect(result).toBe('Hello world')
    })

    it('returns empty string if all turns are filtered out', () => {
      const result = formatSelectedTurns([turns[1]], {
        ...options,
        includeMe: false,
      })
      expect(result).toBe('')
    })
  })

  describe('getTurnRange', () => {
    it('returns turns in between anchor and target', () => {
      expect(getTurnRange(turns, '1', '3')).toEqual(['1', '2', '3'])
      expect(getTurnRange(turns, '3', '1')).toEqual(['1', '2', '3'])
    })

    it('handles single item range', () => {
      expect(getTurnRange(turns, '2', '2')).toEqual(['2'])
    })

    it('handles unknown id gracefully', () => {
      expect(getTurnRange(turns, 'unknown', '2')).toEqual(['2'])
      expect(getTurnRange(turns, '2', 'unknown')).toEqual(['2'])
      expect(getTurnRange(turns, 'unknown1', 'unknown2')).toEqual([])
    })
  })

  describe('toggleShiftTurnSelection', () => {
    it('selects clicked turn and sets anchor if none selected', () => {
      const result = toggleShiftTurnSelection([], '2', turns, null)
      expect(result).toEqual({ selectedIds: ['2'], anchorId: '2' })
    })

    it('deselects turn if single selected turn is clicked again', () => {
      const result = toggleShiftTurnSelection(['2'], '2', turns, '2')
      expect(result).toEqual({ selectedIds: [], anchorId: null })
    })

    it('selects range from anchor to clicked turn', () => {
      const result = toggleShiftTurnSelection(['1'], '3', turns, '1')
      expect(result).toEqual({ selectedIds: ['1', '2', '3'], anchorId: '1' })
    })

    it('uses first selected id as anchor if anchorId is null', () => {
      const result = toggleShiftTurnSelection(['1'], '3', turns, null)
      expect(result).toEqual({ selectedIds: ['1', '2', '3'], anchorId: '1' })
    })
  })

  describe('toggleSingleTurnSelection', () => {
    it('adds unselected turn to selection', () => {
      const result = toggleSingleTurnSelection(['1'], '3', '1')
      expect(result).toEqual({ selectedIds: ['1', '3'], anchorId: '1' })
    })

    it('removes selected turn from selection', () => {
      const result = toggleSingleTurnSelection(['1', '3'], '1', '1')
      expect(result).toEqual({ selectedIds: ['3'], anchorId: '3' })
    })

    it('clears anchor if last item is deselected', () => {
      const result = toggleSingleTurnSelection(['1'], '1', '1')
      expect(result).toEqual({ selectedIds: [], anchorId: null })
    })
  })

  describe('selectRangeUpTo', () => {
    it('selects range from anchor to target turn', () => {
      const result = selectRangeUpTo(['1'], '3', turns, '1')
      expect(result).toEqual({ selectedIds: ['1', '2', '3'], anchorId: '1' })
    })
  })
})
