import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'

import {
  createSettingsSession,
  type SettingsSessionDeps,
} from './settings-session'

const config = () => structuredClone(DEFAULT_USER_CONFIG)
function setup(extra: Partial<SettingsSessionDeps> = {}) {
  const deps: SettingsSessionDeps = {
    initialConfig: config(),
    prepare: (value) => JSON.parse(JSON.stringify(value)),
    save: vi.fn(async (next) => ({ success: true as const, result: next })),
    canSave: () => true,
    notifyError: vi.fn(),
    debounceMs: 100,
    ...extra,
  }
  return { deps, model: createSettingsSession(deps) }
}
afterEach(() => vi.useRealTimers())

describe('settings session', () => {
  it('debounces changes and flushes a pending save on disposal', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup()
    model.draft.value.theme = 'dark'
    model.schedule()
    await vi.advanceTimersByTimeAsync(50)
    model.draft.value.theme = 'light'
    model.schedule()
    model.dispose()
    await model.persist()
    expect(deps.save).toHaveBeenCalledOnce()
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'light' }),
      DEFAULT_USER_CONFIG
    )
  })

  it('keeps a dirty draft and its baseline when another window sends a config', async () => {
    const { deps, model } = setup()
    model.draft.value.theme = 'dark'
    model.applyIncoming({ ...config(), userLanguage: 'ru_RU' })
    await model.persist()
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark' }),
      DEFAULT_USER_CONFIG
    )
  })

  it('serializes saves and retains edits made while saving over merged fields', async () => {
    let finish!: (result: { success: true; result: UserConfig }) => void
    const save = vi
      .fn<SettingsSessionDeps['save']>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockImplementation(async (next) => ({
        success: true as const,
        result: next,
      }))
    const { model } = setup({ save })
    model.draft.value.theme = 'dark'
    const first = model.persist()
    await Promise.resolve()
    model.draft.value.theme = 'light'
    const second = model.persist()
    finish({
      success: true,
      result: { ...config(), theme: 'dark', userLanguage: 'ru_RU' },
    })
    await Promise.all([first, second])
    expect(save.mock.calls[1][0]).toMatchObject({
      theme: 'light',
      userLanguage: 'ru_RU',
    })
    expect(save.mock.calls[1][1]).toMatchObject({
      theme: 'dark',
      userLanguage: 'ru_RU',
    })
    expect(model.draft.value).toMatchObject({
      theme: 'light',
      userLanguage: 'ru_RU',
    })
    expect(model.isSaved()).toBe(true)
  })

  it('retains failed changes and recovers the queue after an exception', async () => {
    const save = vi
      .fn<SettingsSessionDeps['save']>()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockImplementation(async (next) => ({
        success: true as const,
        result: next,
      }))
    const { model, deps } = setup({ save })
    model.draft.value.theme = 'dark'
    await model.persist()
    expect(model.isSaved()).toBe(false)
    expect(deps.notifyError).toHaveBeenCalledWith('Unavailable')
    await model.persist()
    expect(model.isSaved()).toBe(true)
  })
})

describe('settings disposal failures', () => {
  it.each(['result', 'exception'])(
    'reports a failed final save (%s) and retains the draft',
    async (kind) => {
      const save = vi.fn<SettingsSessionDeps['save']>()
      if (kind === 'result')
        save.mockResolvedValueOnce({ success: false, error: 'Unavailable' })
      else save.mockRejectedValueOnce(new Error('Unavailable'))
      save.mockImplementation(async (next) => ({
        success: true as const,
        result: next,
      }))
      const { model, deps } = setup({ save })
      model.draft.value.theme = 'dark'
      await model.dispose()
      expect(deps.notifyError).toHaveBeenCalledWith('Unavailable')
      expect(model.draft.value.theme).toBe('dark')
      expect(model.isSaved()).toBe(false)
      await model.persist()
      expect(model.isSaved()).toBe(true)
    }
  )
})
