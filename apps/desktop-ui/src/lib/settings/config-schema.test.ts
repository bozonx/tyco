import { describe, expect, it } from 'vitest'
import {
  CONFIG_VERSION,
  DEFAULT_USER_CONFIG,
  normalizeUserConfig,
} from '@tyco/shared'
import cases from '../../../../../packages/shared/fixtures/config-normalization.json'

describe('portable user config schema', () => {
  it('validates the authoritative portable defaults', () => {
    expect(DEFAULT_USER_CONFIG.configVersion).toBe(CONFIG_VERSION)
    expect(normalizeUserConfig(DEFAULT_USER_CONFIG)).toEqual(
      DEFAULT_USER_CONFIG
    )
  })

  it.each(cases)(
    'repairs $name identically to the Rust reader',
    ({ input, expected }) => {
      const original = structuredClone(input)
      const result = normalizeUserConfig(input)
      expect(result).toEqual(expected)
      expect(input).toEqual(original)
      expect(normalizeUserConfig(result)).toEqual(result)
    }
  )
})
