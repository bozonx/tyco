import { describe, expect, it } from 'vitest'
import { createPluginResourceUrl } from './plugin-resource-url'

describe('plugin protocol URLs', () => {
  it.each([
    ['tyco-plugin://localhost/', 'tyco-plugin://4142.localhost/'],
    ['http://tyco-plugin.localhost/', 'http://tyco-plugin.4142.localhost/'],
    ['https://tyco-plugin.localhost/', 'https://tyco-plugin.4142.localhost/'],
  ])('preserves routing and resource paths for %s', (input, expected) => {
    const convert = (path: string) => input + encodeURIComponent(path)
    for (const path of ['runtime/index.html', '4142/1.js']) {
      expect(createPluginResourceUrl('AB', path, convert)).toBe(expected + path)
    }
  })
})
