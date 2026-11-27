import { describe, expect, it, vi } from 'vitest'
import { createWebhookSecretsModel } from './webhook-secrets-model'

function setup() {
  const deps = {
    getUrl: vi.fn(() => 'https://example.com/hook'),
    setSecret: vi.fn().mockResolvedValue(undefined),
    removeSecret: vi.fn().mockResolvedValue(undefined),
    afterRender: vi.fn().mockResolvedValue(undefined),
    persist: vi.fn().mockResolvedValue(undefined),
    isSaved: vi.fn(() => true),
    notifyInvalidOrigin: vi.fn(),
    notifySavedOnDevice: vi.fn(),
    reportSaveError: vi.fn(),
    reportRemoveError: vi.fn(),
    isSecretReferenced: vi.fn((_id: string) => false),
  }
  return { deps, model: createWebhookSecretsModel(deps) }
}
describe('webhook header secrets', () => {
  it('keeps a secret the saved config still refers to', async () => {
    const { deps, model } = setup()
    deps.isSecretReferenced.mockReturnValue(true)
    await model.removeUnusedSecret('header-1')
    expect(deps.persist).toHaveBeenCalledOnce()
    expect(deps.removeSecret).not.toHaveBeenCalled()
  })
  it('keeps a secret while the config is not saved', async () => {
    const { deps, model } = setup()
    deps.isSaved.mockReturnValue(false)
    await model.removeUnusedSecret('header-1')
    expect(deps.removeSecret).not.toHaveBeenCalled()
  })
  it('removes a secret once the saved config no longer refers to it', async () => {
    const { deps, model } = setup()
    await model.removeUnusedSecret('header-1')
    expect(deps.removeSecret).toHaveBeenCalledWith('header-1')
  })
  it('reports a failed removal as such', async () => {
    const { deps, model } = setup()
    const error = new Error('locked')
    deps.removeSecret.mockRejectedValue(error)
    await model.removeUnusedSecret('header-1')
    expect(deps.reportRemoveError).toHaveBeenCalledWith(error)
    expect(deps.reportSaveError).not.toHaveBeenCalled()
  })
  it('reports a failed save and keeps the id', async () => {
    const { deps, model } = setup()
    const error = new Error('disk full')
    deps.setSecret.mockRejectedValue(error)
    expect(await model.replaceSecret('header-1', 'v')).toBe(false)
    expect(deps.reportSaveError).toHaveBeenCalledWith(error)
  })
  it('replaces the value of a secret under its id, bound to the URL here', async () => {
    const { deps, model } = setup()
    expect(await model.replaceSecret('header-1', ' v ')).toBe(true)
    // the origin comes from the URL this device sends the webhook to
    expect(deps.setSecret).toHaveBeenCalledWith('header-1', 'v', [
      'https://example.com',
    ])
    expect(await model.replaceSecret('header-1', '  ')).toBe(false)
    deps.getUrl.mockReturnValue('not a url')
    expect(await model.replaceSecret('header-1', 'w')).toBe(false)
    expect(deps.notifyInvalidOrigin).toHaveBeenCalled()
    expect(deps.setSecret).toHaveBeenCalledTimes(1)
  })
})
