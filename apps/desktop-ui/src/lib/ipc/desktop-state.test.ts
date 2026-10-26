import {
  DEFAULT_SESSION_STATE,
  DEFAULT_DESKTOP_VIEW_STATE,
  desktopViewToSnapshot,
  ActivationMode,
  type DesktopViewState,
  type IpcResult,
  type DesktopSnapshot,
} from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'
import { createDesktopStateModel } from './desktop-state'
import type { DesktopCall, DesktopInvoker } from './ipc-model'

const view = (
  revision: number,
  overrides: Partial<DesktopViewState> = {}
): DesktopViewState => ({
  ...structuredClone(DEFAULT_DESKTOP_VIEW_STATE),
  revision,
  ...overrides,
})
const response = (
  revision: number,
  overrides: Partial<DesktopViewState> = {}
): IpcResult<DesktopSnapshot> => ({
  success: true,
  result: desktopViewToSnapshot(view(revision, overrides)),
})

function setup(available = true) {
  const invoke = vi
    .fn<DesktopInvoker['invoke']>()
    .mockResolvedValue(response(0))
  const call = vi.fn<DesktopCall>().mockResolvedValue(response(1))
  const reportFailure = vi.fn()
  const model = createDesktopStateModel({
    desktopClient: {
      invoke: invoke as DesktopInvoker['invoke'],
      isAvailable: () => available,
      getDesktopViewState: () => view(0),
    },
    call: call as DesktopCall,
    reportFailure,
  })
  return { model, invoke, call, reportFailure }
}

describe('desktop state revision ordering', () => {
  it('retains an event newer than the pending initial snapshot', async () => {
    const { model, invoke } = setup()
    let finish!: (value: IpcResult<DesktopSnapshot>) => void
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = model.loadDesktopState()
    model.applyViewState(view(2, { mode: ActivationMode.VOICE }))
    finish(response(1, { mode: ActivationMode.EDITOR }))
    expect((await pending).mode).toBe(ActivationMode.VOICE)
    expect(model.desktopState.value.revision).toBe(2)
  })

  it('rejects an out-of-order event without changing any domain', () => {
    const { model } = setup()
    model.applyViewState(view(3, { selectedText: 'latest' }))
    expect(model.applyViewState(view(2, { selectedText: 'stale' }))).toBe(false)
    expect(model.desktopState.value.selectedText).toBe('latest')
  })

  it('refuses writes until authoritative state arrives', async () => {
    const { model, call } = setup()
    expect(
      (await model.saveUserConfig(DEFAULT_DESKTOP_VIEW_STATE.userConfig))
        .success
    ).toBe(false)
    expect(
      (await model.patchSessionState({ lastChatId: 'chat' })).success
    ).toBe(false)
    expect(call).not.toHaveBeenCalled()
  })

  it('reports a failed initial read and keeps writes blocked', async () => {
    const { model, invoke, reportFailure, call } = setup()
    invoke.mockResolvedValueOnce({
      success: false,
      error: 'Unavailable',
      errorCode: 'serviceUnavailable',
    })
    await expect(model.loadDesktopState()).rejects.toThrow('Unavailable')
    expect(reportFailure).toHaveBeenCalledOnce()
    await model.patchSessionState({ lastChatId: 'chat' })
    expect(call).not.toHaveBeenCalled()
  })

  it('stores a patch over the current config and exposes the result', async () => {
    const { model, call } = setup()
    await model.loadDesktopState()
    const base = model.userConfig.value
    const editor = { ...base.editor, diffViewMode: 'split' as const }
    call.mockResolvedValueOnce(response(1, { userConfig: { ...base, editor } }))
    expect((await model.updateUserConfig({ editor })).success).toBe(true)
    expect(call).toHaveBeenCalledWith('save_user_config', {
      userConfig: { ...base, editor },
      baseConfig: base,
    })
    expect(model.userConfig.value.editor.diffViewMode).toBe('split')
  })

  it('uses detached browser state without invoking the backend', async () => {
    const { model, invoke } = setup(false)
    expect((await model.loadDesktopState()).revision).toBe(0)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not replace newer settings with a delayed save response', async () => {
    const { model, call } = setup()
    await model.loadDesktopState()
    let finish!: (value: IpcResult<DesktopSnapshot>) => void
    call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const dark = {
      ...DEFAULT_DESKTOP_VIEW_STATE.userConfig,
      appearance: {
        ...DEFAULT_DESKTOP_VIEW_STATE.userConfig.appearance,
        theme: 'dark' as const,
      },
    }
    const pending = model.saveUserConfig(dark)
    const newer = view(3, {
      userConfig: {
        ...dark,
        appearance: { ...dark.appearance, theme: 'light' },
      },
    })
    model.applyViewState(newer)
    finish(response(2, { userConfig: dark }))
    const result = await pending
    expect(result).toMatchObject({
      success: true,
      result: { appearance: { theme: 'light' } },
    })
    expect(model.desktopState.value.userConfig.appearance.theme).toBe('light')
  })

  it('preserves state and error codes after a rejected save', async () => {
    const { model, call } = setup()
    await model.loadDesktopState()
    const failure = {
      success: false as const,
      error: 'Conflict',
      errorCode: 'configConflict' as const,
    }
    call.mockResolvedValueOnce(failure)
    expect(
      await model.saveUserConfig({
        ...DEFAULT_DESKTOP_VIEW_STATE.userConfig,
        appearance: {
          ...DEFAULT_DESKTOP_VIEW_STATE.userConfig.appearance,
          theme: 'dark',
        },
      })
    ).toEqual(failure)
    expect(model.desktopState.value.revision).toBe(0)
  })

  it('serializes patches, detaches queued values and applies merged snapshots', async () => {
    const { model, call } = setup()
    await model.loadDesktopState()
    let finish!: (value: IpcResult<DesktopSnapshot>) => void
    call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    call.mockResolvedValueOnce(
      response(2, {
        sessionState: {
          ...DEFAULT_SESSION_STATE,
          lastChatId: 'chat',
          recentAiPrompts: ['original'],
        },
      })
    )
    const first = model.patchSessionState({ lastChatId: 'chat' })
    const prompts = ['original']
    const second = model.patchSessionState({ recentAiPrompts: prompts })
    prompts.push('later')
    await Promise.resolve()
    expect(call).toHaveBeenCalledTimes(1)
    finish(
      response(1, {
        sessionState: { ...DEFAULT_SESSION_STATE, lastChatId: 'chat' },
      })
    )
    await Promise.all([first, second])
    expect(call).toHaveBeenLastCalledWith('patch_session_state', {
      patch: { recentAiPrompts: ['original'] },
    })
    expect(model.desktopState.value.sessionState).toEqual({
      ...DEFAULT_SESSION_STATE,
      lastChatId: 'chat',
      recentAiPrompts: ['original'],
    })
  })

  it('preserves a newer event while a patch is pending', async () => {
    const { model, call } = setup()
    await model.loadDesktopState()
    let finish!: (value: IpcResult<DesktopSnapshot>) => void
    call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = model.patchSessionState({ lastChatId: 'old' })
    await Promise.resolve()
    model.applyViewState(
      view(3, { sessionState: { ...DEFAULT_SESSION_STATE, lastChatId: 'new' } })
    )
    finish(
      response(2, {
        sessionState: { ...DEFAULT_SESSION_STATE, lastChatId: 'old' },
      })
    )
    await pending
    expect(model.desktopState.value.sessionState.lastChatId).toBe('new')
  })

  it('continues processing queued patches after failure', async () => {
    const { model, call, invoke } = setup()
    await model.loadDesktopState()
    call.mockResolvedValueOnce({ success: false, error: 'Disk error' })
    call.mockResolvedValueOnce(
      response(1, {
        sessionState: { ...DEFAULT_SESSION_STATE, lastChatId: 'saved' },
      })
    )
    expect(
      (await model.patchSessionState({ lastChatId: 'failed' })).success
    ).toBe(false)
    await model.patchSessionState({ lastChatId: 'saved' })
    expect(model.desktopState.value.sessionState.lastChatId).toBe('saved')
    expect(invoke).toHaveBeenCalledWith('get_desktop_state')
  })
})

describe('insertion capability', () => {
  it('allows untracked focus return while keeping a tracked desktop without a target disabled', async () => {
    for (const target of ['focusReturn', 'tracked'] as const) {
      const { model, invoke } = setup()
      invoke
        .mockResolvedValueOnce(response(1))
        .mockResolvedValueOnce({
          success: true,
          result: {
            target,
            keys: 'ready',
            keySender: 'ydotool',
            problem: null,
            detail: null,
          },
        } as never)
      await model.loadDesktopState()
      expect(model.desktopState.value.windowId).toBeNull()
      expect(model.canInsertIntoWindow.value).toBe(target === 'focusReturn')
    }
  })

  it('keeps a known target usable when the status request fails', async () => {
    const { model, invoke } = setup()
    invoke
      .mockResolvedValueOnce(response(1, { windowId: 'native-window' }))
      .mockResolvedValueOnce({
        success: false,
        error: 'Unavailable',
        errorCode: 'serviceUnavailable',
      })
    await model.loadDesktopState()
    expect(model.canInsertIntoWindow.value).toBe(true)
  })
})
