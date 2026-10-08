import { describe, expect, it, vi } from 'vitest'

import { createPluginResources, pluginNamespace } from './plugin-resources'

describe('plugin resources', () => {
  it('isolates dictionaries and supplies fallback messages for unsupported locales', () => {
    const host = {
      setMessages: vi.fn(),
      removeMessages: vi.fn(),
      addIcons: vi.fn(),
    }
    const resources = createPluginResources(host, ['en_US', 'ru_RU', 'es_AR'])
    resources.register('First', {
      en_US: { label: 'First', detail: 'Detail' },
      ru_RU: { label: 'First translated' },
    })
    resources.register('Second', { en_US: { label: 'Second' } })
    expect(host.setMessages).toHaveBeenCalledWith(
      'ru_RU',
      pluginNamespace('First'),
      { label: 'First translated', detail: 'Detail' }
    )
    expect(host.setMessages).toHaveBeenCalledWith(
      'es_AR',
      pluginNamespace('First'),
      { label: 'First', detail: 'Detail' }
    )
    resources.remove('First')
    expect(host.removeMessages).toHaveBeenCalledTimes(3)
    expect(host.removeMessages).not.toHaveBeenCalledWith(
      'en_US',
      pluginNamespace('Second')
    )
  })
})
