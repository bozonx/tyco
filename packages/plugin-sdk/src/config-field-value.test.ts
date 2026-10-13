import { describe, expect, it } from 'vitest'
import { withConfigFieldValue } from './config-field-value.js'
import type { InputConfigItem } from './config.js'

describe('withConfigFieldValue', () => {
  it('validates values by their field type', () => {
    expect(
      withConfigFieldValue(
        { type: 'checkbox', name: 'enabled', defaultValue: false },
        'true'
      ).value
    ).toBe(false)
    expect(
      withConfigFieldValue(
        { type: 'textarea', name: 'prompt', defaultValue: 'default' },
        7
      ).value
    ).toBe('default')
    expect(
      withConfigFieldValue({ type: 'text', name: 'count', defaultValue: 0 }, 7)
        .value
    ).toBe(7)
    expect(
      withConfigFieldValue(
        { type: 'text', name: 'count', defaultValue: 0 },
        Infinity
      ).value
    ).toBe(0)
    expect(
      withConfigFieldValue({ type: 'text', name: 'path', defaultValue: '' }, 7)
        .value
    ).toBe('')
    expect(
      withConfigFieldValue(
        {
          type: 'select',
          name: 'mode',
          defaultValue: 'a',
          options: [{ id: 'a' }, { id: 'b' }],
        },
        'unknown'
      ).value
    ).toBe('a')
    expect(
      withConfigFieldValue(
        { type: 'select', name: 'mode', options: [{ id: 0 }] },
        0
      ).value
    ).toBe(0)
  })

  it('normalizes saved checklist values at the compatibility boundary', () => {
    expect(
      withConfigFieldValue(
        {
          type: 'sortable-checklist',
          name: 'actions',
          options: [{ id: 'a' }, { id: 'b' }],
        },
        ['b', 'stale']
      ).value
    ).toEqual([
      { id: 'b', enabled: true },
      { id: 'a', enabled: false },
    ])
  })

  it('rejects mismatched declarations at compile time', () => {
    const checkContracts = () => {
      // @ts-expect-error Checkbox defaults must be booleans.
      const checkbox: InputConfigItem = {
        type: 'checkbox',
        name: 'enabled',
        defaultValue: 'true',
      }
      // @ts-expect-error Textarea values must be strings.
      const textarea: InputConfigItem = {
        type: 'textarea',
        name: 'prompt',
        value: 7,
      }
      void checkbox
      void textarea
    }
    void checkContracts
  })
})
