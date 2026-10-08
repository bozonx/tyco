import { describe, expect, it, vi } from 'vitest'

import { createPluginInstallation } from './plugin-installation'

const preview = {
  path: '/package.tyco-plugin',
  manifest: {
    id: 'example',
    version: '1.0.0',
    apiVersion: 1,
    capabilities: [],
  },
}
function setup() {
  const deps = {
    inspect: vi.fn(async () => preview),
    install: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    reservedIds: ['bundled'],
    reportError: vi.fn(),
  }
  return { deps, model: createPluginInstallation(deps) }
}
describe('plugin installation', () => {
  it('inspects without installation and allows cancelling', async () => {
    const { deps, model } = setup()
    await model.inspect()
    expect(model.preview.value).toEqual(preview)
    expect(deps.install).not.toHaveBeenCalled()
    model.cancel()
    await model.install()
    expect(deps.install).not.toHaveBeenCalled()
  })
  it('installs the reviewed package and refreshes the catalog', async () => {
    const { deps, model } = setup()
    await model.inspect()
    await model.install()
    expect(deps.install).toHaveBeenCalledWith(preview)
    expect(deps.refresh).toHaveBeenCalledOnce()
    expect(model.preview.value).toBeNull()
  })
  it('protects bundled plugins and recovers from failures', async () => {
    const { deps, model } = setup()
    await model.remove('bundled')
    expect(deps.remove).not.toHaveBeenCalled()
    expect(deps.reportError).toHaveBeenCalledOnce()
    deps.install.mockRejectedValueOnce(new Error('disk full'))
    await model.inspect()
    await model.install()
    expect(model.preview.value).toEqual(preview)
    expect(model.busy.value).toBe(false)
  })
})
