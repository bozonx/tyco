import { describe, expect, it, vi } from 'vitest'
import { createSettingsShutdown } from './settings-shutdown'

function fixture(flush = vi.fn(async () => true)) {
  const deps = {
    flush,
    acknowledge: vi.fn(async (_id: number, _saved: boolean) => {}),
    notifyError: vi.fn(),
  }
  return { deps, model: createSettingsShutdown(deps) }
}

describe('settings shutdown', () => {
  it('waits for the draft before acknowledging exit', async () => {
    let finish!: (saved: boolean) => void
    const f = fixture(
      vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          })
      )
    )
    const pending = f.model.request(1)
    expect(f.model.isClosing.value).toBe(true)
    expect(f.deps.acknowledge).not.toHaveBeenCalled()
    finish(true)
    await pending
    expect(f.deps.acknowledge).toHaveBeenCalledWith(1, true)
  })
  it('reports an unsaved draft and handles rejected flushes', async () => {
    const f = fixture(vi.fn().mockRejectedValue(new Error('Unavailable')))
    await f.model.request(1)
    expect(f.deps.acknowledge).toHaveBeenCalledWith(1, false)
    f.model.cancel()
    expect(f.model.isClosing.value).toBe(false)
    expect(f.deps.notifyError).toHaveBeenCalledOnce()
  })
  it('does not acknowledge a request cancelled while saving', async () => {
    let finish!: (saved: boolean) => void
    const f = fixture(
      vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          })
      )
    )
    const pending = f.model.request(1)
    f.model.cancel()
    finish(true)
    await pending
    expect(f.deps.acknowledge).not.toHaveBeenCalled()
  })
})
