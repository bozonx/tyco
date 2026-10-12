import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, DEFAULT_USER_CONFIG } from '@tyco/shared'

import { createSettingsConfig } from './settings-config'

const model = () =>
  createSettingsConfig({
    resolveMainActions: (actions) => actions ?? [],
    getRegisteredActions: () => [{ id: 'new-action' }],
    pluginIndexes: () => [],
    appearance: () => DEFAULT_APPEARANCE,
  })
describe('settings config preparation', () => {
  it('normalizes legacy fields without mutating input', () => {
    const input = {
      ...structuredClone(DEFAULT_USER_CONFIG),
      submitKey: 'invalid',
      chatRoles: ['old'],
      aiRules: { ...DEFAULT_USER_CONFIG.aiRules, base: 'old' },
    }
    const original = structuredClone(input)
    const result = model().prepare(input)
    expect(input).toEqual(original)
    expect(result.submitKey).toBe('enter')
    expect(result).not.toHaveProperty('chatRoles')
    expect(result.aiRules).not.toHaveProperty('base')
    expect(result.mainActionRegistrations).toContain('new-action')
    expect(result.markdown).toBeDefined()
  })
  it('is idempotent', () => {
    const prepare = model().prepare
    const result = prepare(DEFAULT_USER_CONFIG)
    expect(prepare(result)).toEqual(result)
  })
})
