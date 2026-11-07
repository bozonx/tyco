import { DEFAULT_MAIN_ACTIONS, type MainActionConfig } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { slotList } from '../shortcut-slots/shortcut-slots'
import { isMainActionVisible, normalizeMainActions } from './main-actions'

describe('normalizeMainActions', () => {
  it('creates the standard actions for a missing config', () => {
    expect(normalizeMainActions(undefined)).toEqual(
      slotList(DEFAULT_MAIN_ACTIONS)
    )
  })

  it('keeps valid slots and removes unsupported actions', () => {
    expect(
      normalizeMainActions({
        w: { type: 'standard', actionId: 'translationMenu' },
        e: { type: 'custom', command: 'echo nope' },
        r: { type: 'standard', actionId: 'unknown' },
        y: { type: 'standard', actionId: 'askInChat' },
      }).slice(0, 4)
    ).toEqual([
      null,
      { type: 'standard', actionId: 'translationMenu' },
      null,
      null,
    ])
  })

  it('keeps references to commands, transformations and translation languages', () => {
    const raw = {
      q: { type: 'command', commandId: 'sc1' },
      w: { type: 'command', commandId: ' ' },
      e: { type: 'transformation', transformationId: 'shorten' },
      r: { type: 'transformation', transformationId: '' },
      t: { type: 'translation', language: 'en-US' },
      a: { type: 'translation' },
      s: { type: 'actionPage', pageIndex: 2 },
      d: { type: 'actionPage', pageIndex: -1 },
    }
    expect(normalizeMainActions(raw).slice(0, 8)).toEqual([
      { type: 'command', commandId: 'sc1' },
      null,
      { type: 'transformation', transformationId: 'shorten' },
      null,
      { type: 'translation', language: 'en-US' },
      null,
      { type: 'actionPage', pageIndex: 2 },
      null,
    ])
  })
})

describe('isMainActionVisible', () => {
  it.each<MainActionConfig>([
    { type: 'command', commandId: 'script' },
    { type: 'standard', actionId: 'askInChat' },
    { type: 'standard', actionId: 'correction' },
    { type: 'profileChat', profileId: 'assistant' },
    { type: 'standard', actionId: 'copyToClipboard' },
  ])('keeps action %j visible', (action) => {
    expect(isMainActionVisible(action, undefined)).toBe(true)
    expect(isMainActionVisible(action, false)).toBe(true)
    expect(isMainActionVisible(action, true)).toBe(true)
  })
})
