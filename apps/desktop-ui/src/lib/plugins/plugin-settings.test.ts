import { describe, expect, it } from 'vitest'

import type { PluginIndex } from '../../types/plugins'
import {
  getPluginTabKey,
  parsePluginTabKey,
  resolveInstalledPlugins,
} from './plugin-settings'

describe('plugin-settings', () => {
  const samplePlugins: PluginIndex[] = [
    () => ({
      id: 'AlphaPlugin',
      name: 'AlphaPlugin',
      version: '1.0.0',
      apiVersion: 2,
      capabilities: [],
      defaultLocale: 'en_US',
      locales: { en_US: {} },
      labelKey: 'plugin.alpha.label',
      defaultConfig: {
        fields: [{ type: 'text', name: 'apiKey', defaultValue: 'default-key' }],
      },
      init: () => {},
    }),
    () => ({
      id: 'BetaPlugin',
      name: 'BetaPlugin',
      version: '1.0.0',
      apiVersion: 2,
      capabilities: [],
      defaultLocale: 'en_US',
      locales: { en_US: {} },
      label: 'Beta Plugin',
      description: 'Beta description',
      init: () => {},
    }),
  ]

  it('resolves installed plugins with defaults when no userConfig provided', () => {
    const plugins = resolveInstalledPlugins(samplePlugins)

    expect(plugins).toHaveLength(2)
    expect(plugins[0]).toMatchObject({
      name: 'AlphaPlugin',
      version: '1.0.0',
      canRestore: false,
      labelKey: 'plugin.alpha.label',
      enabled: true,
      fields: [
        {
          type: 'text',
          name: 'apiKey',
          defaultValue: 'default-key',
          value: 'default-key',
        },
      ],
    })
    expect(plugins[1].enabled).toBe(true)
    expect(plugins[1].fields).toHaveLength(0)
  })

  it('respects userConfig values and enabled state', () => {
    const userConfig = {
      plugins: {
        AlphaPlugin: { enabled: false, apiKey: 'custom-secret' },
        BetaPlugin: { enabled: true },
      },
    }

    const plugins = resolveInstalledPlugins(samplePlugins, userConfig)

    expect(plugins[0].enabled).toBe(false)
    expect(plugins[0].fields[0].value).toBe('custom-secret')
    expect(plugins[1].enabled).toBe(true)
  })

  it('correctly constructs and parses plugin tab keys', () => {
    expect(getPluginTabKey('AlphaPlugin')).toBe('plugin:AlphaPlugin')
    expect(parsePluginTabKey('plugin:AlphaPlugin')).toBe('AlphaPlugin')
    expect(parsePluginTabKey('plugins')).toBeNull()
    expect(parsePluginTabKey('general')).toBeNull()
  })
})
