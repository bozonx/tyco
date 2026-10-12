import { describe, expect, it } from 'vitest'
import { configFieldLabel, configFieldOptions } from './config-field-labels'

describe('config field labels', () => {
  const t = (key: string) => `Translated ${key}`
  it('prefers translated labels and preserves numeric option values', () => {
    const field = {
      name: 'limit',
      type: 'select' as const,
      label: 'Limit',
      labelKey: 'plugin.limit',
      options: [
        { id: 0, name: 'Zero' },
        { id: 1, name: 'One', labelKey: 'plugin.one' },
      ],
    }
    expect(configFieldLabel(field, t)).toBe('Translated plugin.limit')
    expect(configFieldOptions(field, t)).toEqual([
      { id: 0, name: 'Zero' },
      { id: 1, name: 'Translated plugin.one' },
    ])
  })
  it('supports schema fields without labels or options', () => {
    expect(configFieldLabel({ name: 'enabled', type: 'checkbox' }, t)).toBe(
      'enabled'
    )
    expect(configFieldOptions({ name: 'mode', type: 'select' }, t)).toEqual([])
  })
})
