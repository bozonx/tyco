import { describe, expect, it } from 'vitest'
import {
  CONFIG_VERSION,
  DEFAULT_USER_CONFIG,
  isUserConfig,
  normalizeUserConfig,
} from '@tyco/shared'
import cases from '../../../../../packages/shared/fixtures/config-normalization.json'

describe('portable user config schema', () => {
  it('validates the authoritative portable defaults', () => {
    expect(DEFAULT_USER_CONFIG.configVersion).toBe(CONFIG_VERSION)
    expect(isUserConfig(DEFAULT_USER_CONFIG)).toBe(true)
  })

  it.each(cases)(
    'repairs $name identically to the Rust reader',
    ({ input, expected }) => {
      const original = structuredClone(input)
      const result = normalizeUserConfig(input)
      expect(result).toEqual(expected)
      expect(input).toEqual(original)
      expect(isUserConfig(result)).toBe(true)
      expect(normalizeUserConfig(result)).toEqual(result)
    }
  )

  it('rejects an incomplete command and a config from a newer build', () => {
    const config = structuredClone(DEFAULT_USER_CONFIG)
    expect(isUserConfig({ ...config, commands: [{ id: 'partial' }] })).toBe(
      false
    )
    expect(isUserConfig({ ...config, configVersion: CONFIG_VERSION + 1 })).toBe(
      false
    )
  })
})
