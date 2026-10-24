import { describe, expect, it } from 'vitest'
import {
  CONFIG_VERSION,
  DEFAULT_USER_CONFIG,
  normalizeUserConfig,
} from '@tyco/shared'
import cases from '../../../../../packages/shared/fixtures/config-normalization.json'

describe('portable user config schema', () => {
  it('keeps the development flag optional across serialization', () => {
    const config = normalizeUserConfig({
      ...DEFAULT_USER_CONFIG,
      isInDevelopment: true,
    })
    expect(
      normalizeUserConfig(JSON.parse(JSON.stringify(config))).isInDevelopment
    ).toBe(true)
    delete config.isInDevelopment
    expect(
      Object.hasOwn(
        normalizeUserConfig(JSON.parse(JSON.stringify(config))),
        'isInDevelopment'
      )
    ).toBe(false)
  })

  it('validates the authoritative portable defaults', () => {
    expect(DEFAULT_USER_CONFIG.configVersion).toBe(CONFIG_VERSION)
    expect(normalizeUserConfig(DEFAULT_USER_CONFIG)).toEqual(
      DEFAULT_USER_CONFIG
    )
  })

  it('adds terminal paste defaults to older configs and preserves explicit choices', () => {
    const config = structuredClone(DEFAULT_USER_CONFIG)
    const linux: Record<string, unknown> = config.windowInsertion.linux
    delete linux.terminalPasteShortcut
    expect(
      normalizeUserConfig(config).windowInsertion.linux.terminalPasteShortcut
    ).toBe('Ctrl+Shift+V')
    for (const choice of [null, 'Ctrl+V', 'Ctrl+Shift+V', 'Shift+Insert']) {
      linux.terminalPasteShortcut = choice
      expect(
        normalizeUserConfig(config).windowInsertion.linux.terminalPasteShortcut
      ).toBe(choice)
    }
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
