import { describe, expect, it } from 'vitest'
import { validatePluginManifest } from './validation.js'
const manifest = {
  id: 'Example',
  version: '1.0.0',
  apiVersion: 2,
  capabilities: ['editor'],
  defaultLocale: 'en_US',
  locales: { en_US: { label: 'Example' } },
}
describe('plugin manifest validation', () => {
  it('requires a complete current contract', () => {
    expect(() => validatePluginManifest(manifest)).not.toThrow()
    for (const invalid of [
      { ...manifest, apiVersion: 1 },
      { ...manifest, extra: true },
      { ...manifest, locales: {} },
      { ...manifest, capabilities: ['editor', 'editor'] },
    ])
      expect(() => validatePluginManifest(invalid)).toThrow()
  })
  it('rejects active SVG and settings metadata collisions', () => {
    for (const body of [
      '<script>alert(1)</script>',
      '<path onclick="alert(1)"/>',
      '<use href="https://example.com/icon"/>',
      '<foreignObject/>',
    ])
      expect(() =>
        validatePluginManifest({
          ...manifest,
          icons: { prefix: 'example', icons: { bad: { body } } },
        })
      ).toThrow()
    expect(() =>
      validatePluginManifest({
        ...manifest,
        defaultConfig: {
          fields: [{ name: 'enabled', type: 'checkbox', defaultValue: true }],
        },
      })
    ).toThrow()
  })
})
