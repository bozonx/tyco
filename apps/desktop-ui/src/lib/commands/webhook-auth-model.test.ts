import { describe, expect, it, vi } from 'vitest'
import { createWebhookAuthModel } from './webhook-auth-model'
import { WEBHOOK_AUTH_SECRET_PREFIX } from '@tyco/shared'

function setup() {
  const deps = {
    getUrl: () => 'https://example.com/hook',
    getSecretId: () => 'old-secret',
    createId: () => 'new-id',
    setSecret: vi.fn().mockResolvedValue(undefined),
    removeSecret: vi.fn().mockResolvedValue(undefined),
    update: vi.fn(),
    afterRender: vi.fn().mockResolvedValue(undefined),
    persist: vi.fn().mockResolvedValue(undefined),
    isSaved: vi.fn(() => true),
    notifyInvalidOrigin: vi.fn(),
    reportError: vi.fn(),
  }
  return { deps, model: createWebhookAuthModel(deps) }
}
describe('webhook authorization', () => {
  it('stores a fresh origin-bound secret before enabling authorization', async () => {
    const { deps, model } = setup()
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
    expect(deps.reportError).toHaveBeenCalledWith(error)
    expect(deps.update).not.toHaveBeenCalled()
    expect(model.authDraft.value).toBe('token')
  })
})
