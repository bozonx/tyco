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

  it('keeps references to commands, AI tasks and translation languages', () => {
    const raw = {
      q: { type: 'command', commandId: 'sc1' },
      w: { type: 'command', commandId: ' ' },
      e: { type: 'aiTask', taskId: 'task-1' },
      r: { type: 'aiTask', taskId: '' },
      t: { type: 'translation', language: 'en-US' },
      a: { type: 'translation' },
    }
    expect(normalizeMainActions(raw).slice(0, 6)).toEqual([
      { type: 'command', commandId: 'sc1' },
      null,
      { type: 'aiTask', taskId: 'task-1' },
      null,
      { type: 'translation', language: 'en-US' },
      null,
    ])
  })
})

describe('isMainActionVisible', () => {
  it.each<MainActionConfig>([
    { type: 'command', commandId: 'script' },
    { type: 'launcherPage', pageId: 'page' },
    { type: 'standard', actionId: 'askInChat' },
  ])('shows development action %j only with the flag', (action) => {
    expect(isMainActionVisible(action, undefined)).toBe(false)
    expect(isMainActionVisible(action, false)).toBe(false)
    expect(isMainActionVisible(action, true)).toBe(true)
  })
  it('keeps regular actions visible', () => {
    expect(
      isMainActionVisible({ type: 'standard', actionId: 'correction' }, false)
    ).toBe(true)
  })
})
