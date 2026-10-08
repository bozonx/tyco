import { describe, expect, it, vi } from 'vitest'

import { createPluginPackageLoader } from './plugin-package-loader'

const manifest = {
  id: 'Example',
  version: '1.0.0',
  apiVersion: 1,
  capabilities: [],
}
const definition = {
  ...manifest,
  defaultLocale: 'en_US',
  locales: { en_US: { label: 'Example' } },
  init: vi.fn(),
}
describe('plugin package loader', () => {
  it('loads a validated package once and keeps its identity separate from the label', async () => {
    const deps = {
      importModule: vi.fn(async () => ({ default: () => definition })),
      reportError: vi.fn(),
    }
    const loader = createPluginPackageLoader(deps)
    const packages = [{ manifest, modulePath: '4578616d706c65/123.js' }]
    expect((await loader.load(packages, []))[0]()).toMatchObject({
      name: 'Example',
      _revision: packages[0].modulePath,
    })
    await loader.load(packages, [])
    expect(deps.importModule).toHaveBeenCalledOnce()
  })
  it('rejects reserved IDs, incompatible APIs and paths before importing code', async () => {
    const deps = {
      importModule: vi.fn(async () => ({ default: () => definition })),
      reportError: vi.fn(),
    }
    const loader = createPluginPackageLoader(deps)
    await loader.load([{ manifest, modulePath: '4578/123.js' }], ['Example'])
    await loader.load(
      [
        {
          manifest: { ...manifest, apiVersion: 99 },
          modulePath: '4578/123.js',
        },
      ],
      []
    )
    await loader.load(
      [{ manifest, modulePath: 'https://remote.test/plugin.js' }],
      []
    )
    expect(deps.importModule).not.toHaveBeenCalled()
    expect(deps.reportError).toHaveBeenCalledTimes(3)
  })
  it('isolates a malformed package and continues loading other entries', async () => {
    const deps = {
      importModule: vi.fn(async (path: string) => ({
        default: () =>
          path.startsWith('00') ? { ...definition, id: 'Other' } : definition,
      })),
      reportError: vi.fn(),
    }
    const loader = createPluginPackageLoader(deps)
    const loaded = await loader.load(
      [
        { manifest: { ...manifest, id: 'Broken' }, modulePath: '00/123.js' },
        { manifest, modulePath: '4578/123.js' },
      ],
      []
    )
    expect(loaded).toHaveLength(2)
    expect(loaded[0]()._loadError).toBeTruthy()
    expect(loaded[1]()._loadError).toBeUndefined()
    expect(deps.reportError).toHaveBeenCalledOnce()
  })
})
