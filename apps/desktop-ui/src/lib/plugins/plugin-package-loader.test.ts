import { describe, expect, it, vi } from 'vitest'
import { createPluginPackageLoader } from './plugin-package-loader'
const manifest = {
  id: 'Example',
  version: '1.0.0',
  apiVersion: 2,
  capabilities: [],
  defaultLocale: 'en_US',
  locales: { en_US: { label: 'Example' } },
}
const entry = {
  manifest,
  modulePath: '4578616d706c65/123.js',
  canRestore: false,
}
describe('plugin package loader', () => {
  it('builds metadata for disabled packages without executing any code', async () => {
    const activate = vi.fn(async () => {})
    const loader = createPluginPackageLoader({ activate, reportError: vi.fn() })
    const factory = (await loader.load([entry], []))[0]
    expect(factory()).toMatchObject({
      id: 'Example',
      _external: true,
      _revision: entry.modulePath,
      locales: manifest.locales,
    })
    expect(activate).not.toHaveBeenCalled()
    await factory().init({} as never)
    expect(activate).toHaveBeenCalledOnce()
  })
  it('rejects reserved IDs, incompatible APIs and paths before activation', async () => {
    const activate = vi.fn(async () => {})
    const reportError = vi.fn()
    const loader = createPluginPackageLoader({ activate, reportError })
    await loader.load([entry], ['Example'])
    await loader.load(
      [{ ...entry, manifest: { ...manifest, apiVersion: 99 } }],
      []
    )
    await loader.load(
      [{ ...entry, modulePath: 'https://remote.test/plugin.js' }],
      []
    )
    expect(activate).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledTimes(3)
  })
  it('keeps malformed packages manageable while loading other entries', async () => {
    const loader = createPluginPackageLoader({
      activate: vi.fn(async () => {}),
      reportError: vi.fn(),
    })
    const loaded = await loader.load(
      [
        { ...entry, manifest: { ...manifest, id: 'Broken', locales: {} } },
        entry,
      ],
      []
    )
    expect(loaded).toHaveLength(2)
    expect(loaded[0]()._loadError).toBeTruthy()
    expect(loaded[1]()._loadError).toBeUndefined()
  })
})
