import { describe, expect, it, vi } from 'vitest'
import { PluginCancellation, PluginError } from '@tyco/plugin-sdk'
import { createPluginAction } from './plugin-action'

function setup(action: () => void | Promise<void>) {
  const controller = new AbortController()
  const deps = {
    signal: controller.signal,
    reportError: vi.fn(),
    toast: vi.fn(),
  }
  return { ...createPluginAction(action, deps), deps, controller }
}
describe('plugin UI action', () => {
  it('drops duplicate clicks, exposes running state, and allows subsequent calls', async () => {
    let finish!: () => void
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const { run, state } = setup(action)
    const pending = run()
    expect(state.isRunning).toBe(true)
    await run()
    expect(action).toHaveBeenCalledOnce()
    finish()
    await pending
    expect(state.isRunning).toBe(false)
    const next = run()
    expect(action).toHaveBeenCalledTimes(2)
    finish()
    await next
  })
  it.each([new Error('failure'), new PluginError('local.failure')])(
    'reports failures: %s',
    async (error) => {
      const { run, deps, state } = setup(() => {
        throw error
      })
      await run()
      expect(deps.toast).toHaveBeenCalledWith(
        error instanceof PluginError ? 'local.failure' : 'toast.commandFailed'
      )
      expect(deps.reportError).toHaveBeenCalledWith(error)
      expect(state.isRunning).toBe(false)
    }
  )
  it('silences cancellation and never runs after disposal', async () => {
    const action = vi.fn(() => {
      throw new PluginCancellation()
    })
    const { run, controller, deps } = setup(action)
    await run()
    controller.abort()
    await run()
    expect(action).toHaveBeenCalledOnce()
    expect(deps.toast).not.toHaveBeenCalled()
  })
})
