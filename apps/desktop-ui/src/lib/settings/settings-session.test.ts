import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'

import {
  createSettingsSession,
  type SettingsSessionDependencies,
} from './settings-session'

const config = () => structuredClone(DEFAULT_USER_CONFIG)
function setup(extra: Partial<SettingsSessionDependencies> = {}) {
  const deps: SettingsSessionDependencies = {
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
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('settings session', () => {
  it('debounces changes and flushes a pending save on disposal', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup()
    model.draft.value.appearance.theme = 'dark'
    model.schedule()
    await vi.advanceTimersByTimeAsync(50)
    model.draft.value.appearance.theme = 'light'
    model.schedule()
    model.dispose()
    await model.persist()
    expect(deps.save).toHaveBeenCalledOnce()
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ theme: 'light' }),
      }),
      DEFAULT_USER_CONFIG
    )
  })

  it('keeps a dirty draft and its baseline when another window sends a config', async () => {
    const { deps, model } = setup()
    model.draft.value.appearance.theme = 'dark'
    model.applyIncoming({ ...config(), language: { ui: 'ru-RU' } })
    await model.persist()
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ theme: 'dark' }),
      }),
      DEFAULT_USER_CONFIG
    )
  })

  it('serializes saves and retains edits made while saving over merged fields', async () => {
    let finish!: (result: { success: true; result: UserConfig }) => void
    const save = vi
      .fn<SettingsSessionDependencies['save']>()
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
    model.draft.value.appearance.theme = 'dark'
    const first = model.persist()
    await Promise.resolve()
    model.draft.value.appearance.theme = 'light'
    const second = model.persist()
    finish({
      success: true,
      result: {
        ...config(),
        appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'dark' },
        language: { ui: 'ru-RU' },
      },
    })
    await Promise.all([first, second])
    expect(save.mock.calls[1][0]).toMatchObject({
      appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'light' },
      language: { ui: 'ru-RU' },
    })
    expect(save.mock.calls[1][1]).toMatchObject({
      appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'dark' },
      language: { ui: 'ru-RU' },
    })
    expect(model.draft.value).toMatchObject({
      appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'light' },
      language: { ui: 'ru-RU' },
    })
    expect(model.isSaved()).toBe(true)
  })

  it('retains failed changes and recovers the queue after an exception', async () => {
    const save = vi
      .fn<SettingsSessionDependencies['save']>()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockImplementation(async (next) => ({
        success: true as const,
        result: next,
      }))
    const { model, deps } = setup({ save })
    model.draft.value.appearance.theme = 'dark'
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
      const save = vi.fn<SettingsSessionDependencies['save']>()
      if (kind === 'result')
        save.mockResolvedValueOnce({ success: false, error: 'Unavailable' })
      else save.mockRejectedValueOnce(new Error('Unavailable'))
      save.mockImplementation(async (next) => ({
        success: true as const,
        result: next,
      }))
      const { model, deps } = setup({ save })
      model.draft.value.appearance.theme = 'dark'
      await model.dispose()
      expect(deps.notifyError).toHaveBeenCalledWith('Unavailable')
      expect(model.draft.value.appearance.theme).toBe('dark')
      expect(model.isSaved()).toBe(false)
      await model.persist()
      expect(model.isSaved()).toBe(true)
    }
  )
})

describe('settings concurrency and recovery', () => {
  it('adopts buffered remote changes when local conflicting edits are reverted', () => {
    const { model } = setup()
    model.draft.value.appearance.theme = 'dark'
    model.applyIncoming({
      ...config(),
      appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'light' },
      language: { ui: 'ru-RU' },
    })
    model.draft.value.appearance.theme = DEFAULT_USER_CONFIG.appearance.theme
    model.schedule()
    expect(model.draft.value).toMatchObject({
      appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'light' },
      language: { ui: 'ru-RU' },
    })
    expect(model.conflicts.value).toEqual([])
    expect(model.isSaved()).toBe(true)
  })

  it('recovers from a temporary error using the latest draft', async () => {
    const save = vi
      .fn<SettingsSessionDependencies['save']>()
      .mockResolvedValueOnce({
        success: false,
        error: 'Unavailable',
        errorCode: 'ioError',
      })
      .mockImplementation(async (next) => ({ success: true, result: next }))
    const { model } = setup({ save })
    model.draft.value.appearance.theme = 'dark'
    await model.persist()
    model.draft.value.appearance.theme = 'light'
    model.schedule()
    await vi.advanceTimersByTimeAsync(100)
    expect(save.mock.calls[1][0].appearance.theme).toBe('light')
    expect(model.saveError.value).toBe('')
    expect(model.isSaved()).toBe(true)
  })
  it('coalesces queued edits and never writes a reverted history policy', async () => {
    let finish!: (result: { success: true; result: UserConfig }) => void
    const save = vi
      .fn<SettingsSessionDependencies['save']>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockImplementation(async (next) => ({ success: true, result: next }))
    const { model } = setup({ save })
    model.draft.value.appearance.theme = 'dark'
    const first = model.persist()
    await Promise.resolve()
    model.draft.value.chat.history.storage = 'off'
    const second = model.persist()
    model.draft.value.chat.history.storage = 'disk'
    finish({
      success: true,
      result: {
        ...config(),
        appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'dark' },
        chat: DEFAULT_USER_CONFIG.chat,
      },
    })
    await Promise.all([first, second])
    expect(save).toHaveBeenCalledOnce()
    expect(model.isSaved()).toBe(true)
  })

  it('adopts the newest revision when a delayed save response arrives', async () => {
    let latest = config()
    let finish!: (result: { success: true; result: UserConfig }) => void
    const { model } = setup({
      getLatestConfig: () => latest,
      save: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    model.draft.value.appearance.theme = 'dark'
    const pending = model.persist()
    await Promise.resolve()
    latest = {
      ...config(),
      appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'dark' },
      language: { ui: 'ru-RU' },
    }
    model.applyIncoming(latest)
    finish({
      success: true,
      result: {
        ...config(),
        appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'dark' },
      },
    })
    await pending
    expect(model.draft.value.language.ui).toBe('ru-RU')
    expect(model.isSaved()).toBe(true)
  })

  it('shows conflicting paths and preserves independent remote edits when keeping local changes', async () => {
    const { model, deps } = setup()
    model.draft.value.appearance.theme = 'dark'
    model.applyIncoming({
      ...config(),
      appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'light' },
      language: { ui: 'ru-RU' },
    })
    expect(model.conflicts.value).toEqual(['appearance.theme'])
    await model.persist()
    expect(deps.save).not.toHaveBeenCalled()
    model.resolveConflicts(true)
    await model.persist()
    expect(model.draft.value).toMatchObject({
      appearance: { ...DEFAULT_USER_CONFIG.appearance, theme: 'dark' },
      language: { ui: 'ru-RU' },
    })
    expect(model.isSaved()).toBe(true)
  })

  it('reloads current settings after a backend conflict and allows discarding local edits', async () => {
    const latest = {
      ...config(),
      appearance: {
        ...DEFAULT_USER_CONFIG.appearance,
        theme: 'light' as const,
      },
    }
    const save = vi
      .fn<SettingsSessionDependencies['save']>()
      .mockResolvedValue({
        success: false,
        error: 'Conflict',
        errorCode: 'configConflict',
      })
    const { model } = setup({ save, loadConfig: async () => latest })
    model.draft.value.appearance.theme = 'dark'
    await model.persist()
    expect(model.conflicts.value).toEqual(['appearance.theme'])
    await model.reload()
    expect(model.reloadCount.value).toBe(1)
    expect(model.draft.value.appearance.theme).toBe('light')
    expect(model.isSaved()).toBe(true)
    expect(model.saveError.value).toBe('')
  })

  it('retries temporary failures and stops after three automatic retries', async () => {
    const save = vi
      .fn<SettingsSessionDependencies['save']>()
      .mockResolvedValue({
        success: false,
        error: 'Unavailable',
        errorCode: 'ioError',
      })
    const { model } = setup({ save })
    model.draft.value.appearance.theme = 'dark'
    await model.persist()
    await vi.advanceTimersByTimeAsync(8000)
    expect(save).toHaveBeenCalledTimes(4)
    expect(model.saveError.value).toBe('Unavailable')
    expect(model.hasUnsavedChanges.value).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry invalid settings automatically', async () => {
    const save = vi
      .fn<SettingsSessionDependencies['save']>()
      .mockResolvedValue({
        success: false,
        error: 'Invalid',
        errorCode: 'invalidInput',
      })
    const { model } = setup({ save })
    model.draft.value.appearance.theme = 'dark'
    await model.persist()
    await vi.advanceTimersByTimeAsync(8000)
    expect(save).toHaveBeenCalledOnce()
  })

  it('keeps unfinished fields when another setting is saved', async () => {
    const prepare = (value: unknown) => {
      const next = JSON.parse(JSON.stringify(value)) as UserConfig
      next.aiTasks.items = next.aiTasks.items.filter(
        (task) => task.name || task.prompt
      )
      return next
    }
    const { model } = setup({ prepare })
    model.draft.value.aiTasks.items = [
      {
        id: 'unfinished',
        name: '',
        prompt: '',
        allowedTools: [],
        outputAction: 'replace',
        maxSteps: 5,
      },
    ]
    model.draft.value.appearance.theme = 'dark'
    await model.persist()
    expect(model.draft.value.aiTasks.items[0]?.id).toBe('unfinished')
    expect(model.isSaved()).toBe(true)
  })

  it('keeps the first edit after a save from looking saved', async () => {
    const { deps, model } = setup()
    model.draft.value.appearance.theme = 'dark'
    await model.persist()
    model.draft.value.appearance.theme = 'light'
    expect(model.isSaved()).toBe(false)
    model.schedule()
    expect(model.draft.value.appearance.theme).toBe('light')
    await model.persist()
    expect(deps.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ theme: 'light' }),
      }),
      expect.anything()
    )
  })

  it('merges independent entity collection edits without conflict', async () => {
    const { model } = setup()
    const cmd1 = { ...config().commands[0]!, id: 'cmd1', name: 'First' }
    const cmd2 = { ...config().commands[0]!, id: 'cmd2', name: 'Second' }
    model.draft.value.commands = [cmd1, cmd2]
    await model.persist()
    // Local edit: modify cmd1
    model.draft.value.commands = [{ ...cmd1, name: 'First Modified' }, cmd2]
    // Remote edit arrived from another window: modify cmd2
    model.applyIncoming({
      ...config(),
      commands: [cmd1, { ...cmd2, name: 'Second Remote' }],
    })
    expect(model.conflicts.value).toEqual([])
    model.resolveConflicts(true)
    expect(model.draft.value.commands).toEqual([
      expect.objectContaining({ id: 'cmd1', name: 'First Modified' }),
      expect.objectContaining({ id: 'cmd2', name: 'Second Remote' }),
    ])
  })
})
