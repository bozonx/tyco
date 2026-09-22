import { describe, expect, it } from 'vitest'

import {
  QUICK_PANEL_MAX_HEIGHT,
  QUICK_PANEL_MIN_HEIGHT,
  quickPanelWindowHeight,
} from './quick-panel-size'

describe('quick-panel-size', () => {
  it('starts at the single-line window height', () => {
    expect(quickPanelWindowHeight(64)).toBe(QUICK_PANEL_MIN_HEIGHT)
  })

  it('grows with multiline content', () => {
    expect(quickPanelWindowHeight(140)).toBe(156)
  })

  it('caps growth and leaves overflow to the editor', () => {
    expect(quickPanelWindowHeight(500)).toBe(QUICK_PANEL_MAX_HEIGHT)
  })
})
