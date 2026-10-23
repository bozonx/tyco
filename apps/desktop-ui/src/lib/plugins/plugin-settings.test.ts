import { describe, expect, it } from 'vitest'

import type { PluginFactory } from '../../types/plugins'
import { resolveInstalledPlugins } from './plugin-settings'

describe('plugin-settings', () => {
  const samplePlugins: PluginFactory[] = [
    () => ({
      id: 'AlphaPlugin',
      name: 'AlphaPlugin',
      version: '1.0.0',
      apiVersion: 2,
      capabilities: [],
      defaultLocale: 'en-US',
      locales: { 'en-US': {}, 'ru-RU': {}, 'es-AR': {}, 'tr-TR': {} },
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
      defaultLocale: 'en-US',
      locales: { 'en-US': {}, 'ru-RU': {}, 'es-AR': {}, 'tr-TR': {} },
      label: 'Beta Plugin',
      description: 'Beta description',
      init: () => {},
    }),
  ]

  it('resolves installed plugins with defaults when no userConfig provided', () => {
    const plugins = resolveInstalledPlugins(samplePlugins)

    expect(plugins).toHaveLength(2)
    expect(plugins[0]).toMatchObject({
      pluginId: 'AlphaPlugin',
      version: '1.0.0',
      canRestore: false,
      labelKey: 'plugin.alpha.label',
      isEnabled: false,
      fields: [
        {
          type: 'text',
          name: 'apiKey',
          defaultValue: 'default-key',
          value: 'default-key',
        },
      ],
    })
    expect(plugins[1].isEnabled).toBe(false)
    expect(plugins[1].fields).toHaveLength(0)
  })

  it('respects userConfig values and enabled state', () => {
    const userConfig = {
      plugins: {
        AlphaPlugin: {
          isEnabled: false,
          settings: { apiKey: 'custom-secret' },
        },
        BetaPlugin: { isEnabled: true, settings: {} },
      },
    }

    const plugins = resolveInstalledPlugins(samplePlugins, userConfig)

    expect(plugins[0].isEnabled).toBe(false)
    expect(plugins[0].fields[0].value).toBe('custom-secret')
    expect(plugins[1].isEnabled).toBe(true)
  })

  it.each(['active', 'disabled'] as const)(
    'hides the ordinary %s runtime status',
    (status) => {
      const plugins = resolveInstalledPlugins(
        samplePlugins,
        { plugins: { AlphaPlugin: { isEnabled: true, settings: {} } } },
        { AlphaPlugin: { status } }
      )
      expect(plugins[0].status).toBeUndefined()
    }
  )

  it.each(['activating', 'error', 'incompatible'] as const)(
    'shows the exceptional %s runtime status',
    (status) => {
      const plugins = resolveInstalledPlugins(
        samplePlugins,
        { plugins: { AlphaPlugin: { isEnabled: true, settings: {} } } },
        { AlphaPlugin: { status } }
      )
      expect(plugins[0].status).toBe(status)
    }
  )
})
