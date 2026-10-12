import { describe, expect, it, vi } from 'vitest'

import { createSecretsState } from './secrets-state'
import type { SecretsStatus, VaultState } from './secrets'

function setup() {
  const deps = {
    status: vi.fn(async (): Promise<SecretsStatus> => ({
      key: { origins: [], available: true },
    })),
    vaultState: vi.fn(async (): Promise<VaultState> => 'available'),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  }
  return { deps, model: createSecretsState(deps) }
}

describe('secrets state', () => {
  it('updates status after writes without retaining the secret value', async () => {
    const { deps, model } = setup()
    await model.setSecret('key', 'credential', ['https://example.com'])
    expect(deps.set).toHaveBeenCalledWith('key', 'credential', [
      'https://example.com',
    ])
    expect(JSON.stringify(model.secrets.value)).not.toContain('credential')
    await model.removeSecret('key')
    expect(deps.remove).toHaveBeenCalledWith('key')
    expect(deps.status).toHaveBeenCalledTimes(2)
  })

  it('ignores an older refresh that completes after the newest one', async () => {
    const { deps, model } = setup()
    let resolveOld!: (value: SecretsStatus) => void
    deps.status.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    const old = model.refreshSecrets()
    await model.refreshSecrets()
    resolveOld({})
    await old
    expect(model.secrets.value.key?.available).toBe(true)
  })

  it('keeps the last complete snapshot if a refresh fails', async () => {
    const { deps, model } = setup()
    await model.refreshSecrets()
    deps.vaultState.mockRejectedValueOnce(new Error('unavailable'))
    await expect(model.refreshSecrets()).rejects.toThrow('unavailable')
    expect(model.secrets.value.key?.available).toBe(true)
    expect(model.vaultState.value).toBe('available')
  })
})
