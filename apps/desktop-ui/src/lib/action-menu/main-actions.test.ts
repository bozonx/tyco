import { DEFAULT_MAIN_ACTIONS, type PluginMainAction } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { assignPluginActions, normalizeMainActions } from './main-actions'

describe('normalizeMainActions', () => {
  it('creates the standard actions for a missing config', () => {
    expect(normalizeMainActions(undefined).slice(0, 6)).toEqual(
      DEFAULT_MAIN_ACTIONS
    )
  })

  it('keeps valid slots and removes unsupported actions', () => {
    expect(
      normalizeMainActions([
        null,
        { type: 'standard', actionId: 'translation' },
        { type: 'custom', command: 'echo nope' },
        { type: 'standard', actionId: 'unknown' },
      ]).slice(0, 4)
    ).toEqual([null, { type: 'standard', actionId: 'translation' }, null, null])
  })

  it('normalizes script and webhook actions', () => {
    const raw = [
      {
        type: 'script',
        id: 'sc1',
        name: 'My Script',
        command: 'echo 1',
        logOutput: true,
      },
      {
        type: 'webhook',
        id: 'wh1',
        name: 'My Hook',
        url: 'https://example.com',
      },
      { type: 'script', id: '', command: 'no-id' },
    ]
    expect(normalizeMainActions(raw).slice(0, 3)).toEqual([
      {
        type: 'script',
        id: 'sc1',
        name: 'My Script',
        command: 'echo 1',
        logOutput: true,
      },
      {
        type: 'webhook',
        id: 'wh1',
        name: 'My Hook',
        url: 'https://example.com',
        method: 'POST',
        headers: undefined,
        payloadTemplate: undefined,
        logOutput: false,
      },
      null,
    ])
  })
})

describe('assignPluginActions', () => {
  const search = { id: 'Search:search', preferredKey: 'v' }
  const note = { id: 'Notes:create', preferredKey: 'c' }

  it('assigns preferred keys and keeps the other slots empty', () => {
    const slots = assignPluginActions(undefined, [search, note])
    expect(slots[13]).toEqual({ type: 'plugin', actionId: search.id })
    expect(slots[12]).toEqual({ type: 'plugin', actionId: note.id })
    expect(slots.slice(6, 12)).toEqual(Array(6).fill(null))
  })

  it('uses the first free slot when a preferred key is occupied', () => {
    const config = normalizeMainActions(undefined)
    config[13] = { type: 'standard', actionId: 'translation' }
    const slots = assignPluginActions(config, [search, note])
    expect(slots[13]).toEqual(config[13])
    expect((slots[6] as PluginMainAction)?.actionId).toBe(search.id)
    expect((slots[12] as PluginMainAction)?.actionId).toBe(note.id)
  })

  it('preserves user assignments through normalization and re-registration', () => {
    const config = normalizeMainActions(undefined)
    config[9] = { type: 'plugin', actionId: search.id }
    const slots = assignPluginActions(JSON.parse(JSON.stringify(config)), [
      search,
    ])
    expect(slots[9]).toEqual(config[9])
    expect(slots[13]).toBeNull()
    expect(
      slots.filter(
        (slot) => slot?.type === 'plugin' && slot.actionId === search.id
      )
    ).toHaveLength(1)
  })

  it('does not restore an action removed by the user', () => {
    expect(assignPluginActions(undefined, [search], [search.id])).toEqual(
      normalizeMainActions(undefined)
    )
  })

  it('handles duplicate registrations, invalid keys, and full menus', () => {
    const slots = assignPluginActions(undefined, [
      search,
      search,
      { ...note, preferredKey: '?' },
    ])
    expect(
      slots.filter(
        (slot) => slot?.type === 'plugin' && slot.actionId === search.id
      )
    ).toHaveLength(1)
    expect((slots[6] as PluginMainAction)?.actionId).toBe(note.id)
    const full = Array(15).fill({ type: 'standard', actionId: 'translation' })
    expect(assignPluginActions(full, [search])).toEqual(full)
  })

  it('keeps assignments for unavailable plugins reserved', () => {
    const config = normalizeMainActions(undefined)
    config[13] = { type: 'plugin', actionId: 'Disabled:action' }
    expect(
      (assignPluginActions(config, [search])[6] as PluginMainAction)?.actionId
    ).toBe(search.id)
    expect(normalizeMainActions(config)[13]).toEqual(config[13])
  })
})
