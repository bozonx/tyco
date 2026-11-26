import { describe, expect, it } from 'vitest'

import {
  computeMarqueeRect,
  computeMarqueeSelection,
  getMarqueeMode,
  isMarqueeIgnoredTarget,
  rectsIntersect,
} from './dialog-marquee-selection'

describe('dialog-marquee-selection', () => {
  describe('computeMarqueeRect', () => {
    it('normalizes drag rectangle coordinates regardless of drag direction', () => {
      // Top-left to bottom-right
      expect(computeMarqueeRect(10, 20, 50, 70)).toEqual({
        left: 10,
        top: 20,
        right: 50,
        bottom: 70,
        width: 40,
        height: 50,
      })

      // Bottom-right to top-left
      expect(computeMarqueeRect(50, 70, 10, 20)).toEqual({
        left: 10,
        top: 20,
        right: 50,
        bottom: 70,
        width: 40,
        height: 50,
      })
    })
  })

  describe('rectsIntersect', () => {
    const box = { left: 100, top: 100, right: 200, bottom: 200 }

    it('returns true when rectangles overlap', () => {
      expect(
        rectsIntersect(box, { left: 150, top: 150, right: 250, bottom: 250 })
      ).toBe(true)
      expect(
        rectsIntersect(box, { left: 50, top: 50, right: 150, bottom: 150 })
      ).toBe(true)
      expect(
        rectsIntersect(box, { left: 110, top: 110, right: 190, bottom: 190 })
      ).toBe(true)
    })

    it('returns false when rectangles do not overlap', () => {
      // Completely to the right
      expect(
        rectsIntersect(box, { left: 210, top: 100, right: 300, bottom: 200 })
      ).toBe(false)
      // Completely above
      expect(
        rectsIntersect(box, { left: 100, top: 10, right: 200, bottom: 90 })
      ).toBe(false)
    })

    it('handles edge touching as intersection', () => {
      expect(
        rectsIntersect(box, { left: 200, top: 100, right: 250, bottom: 200 })
      ).toBe(true)
    })
  })

  describe('getMarqueeMode', () => {
    it('returns replace by default without modifier keys', () => {
      expect(
        getMarqueeMode({ shiftKey: false, ctrlKey: false, metaKey: false })
      ).toBe('replace')
    })

    it('returns union when Shift is pressed', () => {
      expect(
        getMarqueeMode({ shiftKey: true, ctrlKey: false, metaKey: false })
      ).toBe('union')
    })

    it('returns toggle when Ctrl or Meta is pressed', () => {
      expect(
        getMarqueeMode({ shiftKey: false, ctrlKey: true, metaKey: false })
      ).toBe('toggle')
      expect(
        getMarqueeMode({ shiftKey: false, ctrlKey: false, metaKey: true })
      ).toBe('toggle')
      // Ctrl/Meta takes precedence over Shift
      expect(
        getMarqueeMode({ shiftKey: true, ctrlKey: true, metaKey: false })
      ).toBe('toggle')
    })
  })

  describe('computeMarqueeSelection', () => {
    const allTurnIds = ['1', '2', '3', '4', '5']

    it('replaces selection in replace mode', () => {
      const base = ['1', '2']
      const intersected = ['3', '4']
      expect(computeMarqueeSelection(base, intersected, 'replace')).toEqual([
        '3',
        '4',
      ])
    })

    it('unions selection in union mode (Shift)', () => {
      const base = ['1', '2']
      const intersected = ['2', '3']
      expect(computeMarqueeSelection(base, intersected, 'union')).toEqual([
        '1',
        '2',
        '3',
      ])
    })

    it('toggles selection in toggle mode (Ctrl/Cmd)', () => {
      // 1 was selected, not intersected -> stays selected
      // 2 was selected, intersected -> toggled off
      // 3 was not selected, intersected -> toggled on
      const base = ['1', '2']
      const intersected = ['2', '3']
      expect(computeMarqueeSelection(base, intersected, 'toggle')).toEqual([
        '1',
        '3',
      ])
    })

    it('preserves order from allTurnIds when provided', () => {
      const base = ['4']
      const intersected = ['1', '3']
      expect(
        computeMarqueeSelection(base, intersected, 'union', allTurnIds)
      ).toEqual(['1', '3', '4'])
    })
  })

  describe('isMarqueeIgnoredTarget', () => {
    it('returns false for empty target or non-element', () => {
      expect(isMarqueeIgnoredTarget(null)).toBe(false)
    })

    it('returns true when target is or is inside a dialog turn', () => {
      const turnEl = document.createElement('article')
      turnEl.className = 'dialog-turn is-bubble is-remote'
      const p = document.createElement('p')
      turnEl.appendChild(p)
      document.body.appendChild(turnEl)

      expect(isMarqueeIgnoredTarget(p)).toBe(true)
      expect(isMarqueeIgnoredTarget(turnEl)).toBe(true)

      document.body.removeChild(turnEl)
    })

    it('returns true for interactive elements like buttons and checkboxes', () => {
      const btn = document.createElement('button')
      document.body.appendChild(btn)
      expect(isMarqueeIgnoredTarget(btn)).toBe(true)
      document.body.removeChild(btn)
    })

    it('returns false for container element background', () => {
      const feed = document.createElement('div')
      feed.className = 'dialog-feed is-bubbles'
      document.body.appendChild(feed)
      expect(isMarqueeIgnoredTarget(feed)).toBe(false)
      document.body.removeChild(feed)
    })
  })
})
