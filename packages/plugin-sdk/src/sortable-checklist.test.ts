import { describe, expect, it } from 'vitest'

import type { InputConfigOption } from './config.js'
import {
  getActiveChecklistIds,
  resolveSortableChecklist,
} from './sortable-checklist.js'

describe('sortable-checklist helper', () => {
  const options: InputConfigOption[] = [
    { id: 'acute', labelKey: 'plugin.diacritics.acute' },
    { id: 'grave', labelKey: 'plugin.diacritics.grave' },
    { id: 'circumflex', labelKey: 'plugin.diacritics.circumflex' },
  ]

  it('resolves defaultValue when saved value is missing or empty', () => {
    const defaultValue = [{ id: 'acute', enabled: true }]
    const resolved = resolveSortableChecklist(undefined, options, defaultValue)

    expect(resolved).toEqual([
      { id: 'acute', enabled: true },
      { id: 'grave', enabled: false },
      { id: 'circumflex', enabled: false },
    ])
  })

  it('supports defaultValue as array of string IDs', () => {
    const defaultValue = ['grave', 'circumflex']
    const resolved = resolveSortableChecklist(undefined, options, defaultValue)

    expect(resolved).toEqual([
      { id: 'grave', enabled: true },
      { id: 'circumflex', enabled: true },
      { id: 'acute', enabled: false },
    ])
  })

  it('preserves saved order and enabled flags', () => {
    const saved = [
      { id: 'circumflex', enabled: true },
      { id: 'acute', enabled: false },
      { id: 'grave', enabled: true },
    ]
    const resolved = resolveSortableChecklist(saved, options)

    expect(resolved).toEqual([
      { id: 'circumflex', enabled: true },
      { id: 'acute', enabled: false },
      { id: 'grave', enabled: true },
    ])
  })

  it('discards stale IDs and appends missing options', () => {
    const saved = [
      { id: 'unknown-id', enabled: true },
      { id: 'grave', enabled: true },
    ]
    const resolved = resolveSortableChecklist(saved, options)

    expect(resolved).toEqual([
      { id: 'grave', enabled: true },
      { id: 'acute', enabled: false },
      { id: 'circumflex', enabled: false },
    ])
  })

  it('extracts active IDs in order', () => {
    const items = [
      { id: 'circumflex', enabled: true },
      { id: 'acute', enabled: false },
      { id: 'grave', enabled: true },
    ]
    expect(getActiveChecklistIds(items)).toEqual(['circumflex', 'grave'])
  })
})
