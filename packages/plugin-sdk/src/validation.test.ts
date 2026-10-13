import { describe, expect, it } from 'vitest'
import { validatePluginManifest, validatePluginFields } from './validation.js'
const manifest = {
  id: 'Example',
  version: '1.0.0',
  apiVersion: 2,
  capabilities: ['editor'],
  defaultLocale: 'en_US',
  locales: Object.fromEntries(
    ['en_US', 'ru_RU', 'es_AR', 'tr_TR'].map((locale) => [
      locale,
      { label: 'Example' },
    ])
  ),
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

describe('plugin locale completeness', () => {
  it('rejects missing locales, keys, changed types and interpolation arguments', () => {
    const dictionaries = Object.fromEntries(
      ['en_US', 'ru_RU', 'es_AR', 'tr_TR'].map((locale) => [
        locale,
        { nested: { label: 'Hello {name}' } },
      ])
    )
    for (const invalid of [
      { ...dictionaries, tr_TR: undefined },
      {
        en_US: { label: 'Text' },
        ru_RU: { label: {} },
        es_AR: { label: 'Text' },
        tr_TR: { label: 'Text' },
      },
      { ...dictionaries, ru_RU: { nested: {} } },
      { ...dictionaries, ru_RU: { nested: 'Hello {name}' } },
      { ...dictionaries, ru_RU: { nested: { label: 'Hello {user}' } } },
    ])
      expect(() =>
        validatePluginManifest({ ...manifest, locales: invalid })
      ).toThrow()
    expect(() =>
      validatePluginManifest({
        ...manifest,
        locales: {
          ...dictionaries,
          ru_RU: { nested: { label: '{name}, welcome {name}' } },
        },
      })
    ).not.toThrow()
  })
})

describe('plugin field value contracts', () => {
  it.each([
    { name: 'feature', type: 'checkbox', defaultValue: true, value: 'false' },
    { name: 'prompt', type: 'textarea', defaultValue: 7 },
    { name: 'path', type: 'text', defaultValue: {} },
    { name: 'count', type: 'text', defaultValue: Infinity },
    {
      name: 'actions',
      type: 'sortable-checklist',
      defaultValue: [{ id: 'a', enabled: 'true' }],
    },
    {
      name: 'mode',
      type: 'select',
      options: [{ id: 'a' }],
      defaultValue: 'a',
      value: 'missing',
    },
  ])('rejects declarations outside the field type: %j', (field) => {
    expect(() => validatePluginFields([field])).toThrow()
  })

  it('accepts typed defaults and optional values', () => {
    expect(() =>
      validatePluginFields([
        { name: 'feature', type: 'checkbox', defaultValue: false },
        { name: 'prompt', type: 'textarea', defaultValue: '' },
        { name: 'count', type: 'text', defaultValue: 0 },
        { name: 'mode', type: 'select', options: [{ id: 0 }], defaultValue: 0 },
        {
          name: 'actions',
          type: 'sortable-checklist',
          defaultValue: [{ id: 'a', enabled: false }],
        },
      ])
    ).not.toThrow()
  })
})

import manifestCases from './test-fixtures/manifests.json'
it.each(manifestCases)(
  'matches the native contract: $name',
  ({ valid, manifest }) => {
    if (valid) expect(() => validatePluginManifest(manifest)).not.toThrow()
    else expect(() => validatePluginManifest(manifest)).toThrow()
  }
)
