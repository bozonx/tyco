import { describe, expect, it, vi } from 'vitest'
import { createWebhookAuthModel } from './webhook-auth-model'
import { WEBHOOK_AUTH_SECRET_PREFIX } from '@tyco/shared'

function setup(secretId = 'old-secret') {
  const deps = {
    getUrl: vi.fn(() => 'https://example.com/hook'),
    getSecretId: () => secretId,
    createId: () => 'new-id',
    setSecret: vi.fn().mockResolvedValue(undefined),
    removeSecret: vi.fn().mockResolvedValue(undefined),
    update: vi.fn(),
    afterRender: vi.fn().mockResolvedValue(undefined),
    persist: vi.fn().mockResolvedValue(undefined),
    isSaved: vi.fn(() => true),
    notifyInvalidOrigin: vi.fn(),
    notifySavedOnDevice: vi.fn(),
    reportSaveError: vi.fn(),
    reportRemoveError: vi.fn(),
    getSecretOrigins: vi.fn((_id: string): string[] => []),
    isSecretReferenced: vi.fn((_id: string) => false),
  }
  return { deps, model: createWebhookAuthModel(deps) }
}
describe('webhook authorization', () => {
  it('stores a fresh origin-bound secret before enabling authorization', async () => {
    const { deps, model } = setup('')
    model.authDraft.value = ' token '
    await model.saveAuth()
    expect(deps.setSecret).toHaveBeenCalledWith(
      `${WEBHOOK_AUTH_SECRET_PREFIX}new-id`,
      'token',
      ['https://example.com']
    )
    expect(deps.update.mock.calls).toEqual([
      ['authSecretId', `${WEBHOOK_AUTH_SECRET_PREFIX}new-id`],
      ['isAuthEnabled', true],
    ])
    expect(model.authDraft.value).toBe('')
  })
  it('retains credentials if disabling authorization was not persisted', async () => {
    const { deps, model } = setup()
    deps.isSaved.mockReturnValue(false)
    await model.removeAuth()
    expect(deps.persist).toHaveBeenCalledOnce()
    expect(deps.removeSecret).not.toHaveBeenCalled()
  })
  it('reports secret errors and preserves the entered value', async () => {
    const { deps, model } = setup()
    const error = new Error('disk full')
    deps.setSecret.mockRejectedValue(error)
    model.authDraft.value = 'token'
    await model.saveAuth()
    expect(deps.reportSaveError).toHaveBeenCalledWith(error)
    expect(deps.removeSecret).not.toHaveBeenCalled()
    expect(deps.update).not.toHaveBeenCalled()
    expect(model.authDraft.value).toBe('token')
  })
  it('puts a key entered again under the id the config has', async () => {
    // another device made the id: entering the key here must not change it,
    // or that device would lose its own key
    const { deps, model } = setup('webhook.auth.shared')
    model.authDraft.value = 'token'
    await model.saveAuth()
    expect(deps.setSecret).toHaveBeenCalledWith(
      'webhook.auth.shared',
      'token',
      ['https://example.com']
    )
    expect(deps.update.mock.calls).toEqual([['isAuthEnabled', true]])
    expect(deps.removeSecret).not.toHaveBeenCalled()
    expect(deps.notifySavedOnDevice).toHaveBeenCalled()
  })
  it('clears the secret id when authorization is removed', async () => {
    const { deps, model } = setup()
    await model.removeAuth()
    expect(deps.update.mock.calls).toEqual([
      ['isAuthEnabled', false],
      ['authSecretId', undefined],
    ])
    expect(deps.removeSecret).toHaveBeenCalledWith('old-secret')
  })
  it('reports a failed removal as such', async () => {
    const { deps, model } = setup()
    const error = new Error('locked')
    deps.removeSecret.mockRejectedValue(error)
    await model.removeAuth()
    expect(deps.reportRemoveError).toHaveBeenCalledWith(error)
    expect(deps.reportSaveError).not.toHaveBeenCalled()
  })
  it('replaces the value of a secret under its id, bound to the URL here', async () => {
    const { deps, model } = setup()
    deps.getSecretOrigins.mockReturnValue(['https://api.test'])
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
