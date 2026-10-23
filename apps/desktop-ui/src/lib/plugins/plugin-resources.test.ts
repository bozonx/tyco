import { describe, expect, it, vi } from 'vitest'
import { SUPPORTED_PLUGIN_LOCALES } from '@tyco/plugin-sdk'

import { createPluginResources, pluginNamespace } from './plugin-resources'

const locales = (label: string) =>
  Object.fromEntries(
    SUPPORTED_PLUGIN_LOCALES.map((locale) => [
      locale,
      { label: `${label}:${locale}` },
    ])
  )

describe('plugin resources', () => {
  it('isolates complete dictionaries without substituting another locale', () => {
    const host = {
      setMessages: vi.fn(),
      removeMessages: vi.fn(),
      addIcons: vi.fn(),
    }
    const resources = createPluginResources(host, SUPPORTED_PLUGIN_LOCALES)
    resources.register('First', locales('First'))
    resources.register('Second', locales('Second'))
    expect(host.setMessages).toHaveBeenCalledWith(
      'ru-RU',
      pluginNamespace('First'),
      { label: 'First:ru-RU' }
    )
    resources.remove('First')
    expect(host.removeMessages).toHaveBeenCalledTimes(4)
    expect(host.removeMessages).not.toHaveBeenCalledWith(
      'en-US',
      pluginNamespace('Second')
    )
  })

  it('rejects incomplete replacements before removing the existing resources', () => {
    const host = { setMessages: vi.fn(), removeMessages: vi.fn() }
    const resources = createPluginResources(host, SUPPORTED_PLUGIN_LOCALES)
    resources.register('First', locales('First'))
    expect(() =>
      resources.register('First', { 'en-US': { label: 'First' } })
    ).toThrow('Missing plugin locale')
    expect(host.removeMessages).not.toHaveBeenCalled()
  })
})
