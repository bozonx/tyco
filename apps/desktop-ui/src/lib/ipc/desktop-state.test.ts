import {
  DEFAULT_DESKTOP_VIEW_STATE,
  DESKTOP_COMMANDS,
  desktopViewToSnapshot,
  StartMode,
  type DesktopViewState,
  type IpcResult,
  type DesktopSnapshot,
} from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'
import { createDesktopStateModel } from './desktop-state'
import type { DesktopInvoker } from './ipc-model'
import type { DesktopCall } from './desktop-functions'

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
  const callFunction = vi.fn<DesktopCall>().mockResolvedValue(response(1))
  const reportFailure = vi.fn()
  const model = createDesktopStateModel({
    desktopClient: {
      invoke: invoke as DesktopInvoker['invoke'],
      isAvailable: () => available,
      getDesktopViewState: () => view(0),
    },
    callFunction: callFunction as DesktopCall,
    reportFailure,
  })
  return { model, invoke, callFunction, reportFailure }
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
    model.applyViewState(view(2, { mode: StartMode.VOICE }))
    finish(response(1, { mode: StartMode.EDITOR }))
    expect((await pending).mode).toBe(StartMode.VOICE)
    expect(model.desktopState.value.revision).toBe(2)
  })

  it('rejects an out-of-order event without changing any domain', () => {
    const { model } = setup()
    model.applyViewState(view(3, { selectedText: 'latest' }))
    expect(model.applyViewState(view(2, { selectedText: 'stale' }))).toBe(false)
    expect(model.desktopState.value.selectedText).toBe('latest')
  })

  it('refuses writes until authoritative state arrives', async () => {
    const { model, callFunction } = setup()
    expect(
      (await model.saveUserConfig(DEFAULT_DESKTOP_VIEW_STATE.userConfig))
        .success
    ).toBe(false)
    expect(
      (await model.patchSessionState({ lastChatId: 'chat' })).success
    ).toBe(false)
    expect(callFunction).not.toHaveBeenCalled()
  })

  it('reports a failed initial read and keeps writes blocked', async () => {
    const { model, invoke, reportFailure, callFunction } = setup()
    invoke.mockResolvedValueOnce({
      success: false,
      error: 'Unavailable',
      errorCode: 'serviceUnavailable',
    })
    await expect(model.loadDesktopState()).rejects.toThrow('Unavailable')
    expect(reportFailure).toHaveBeenCalledOnce()
    await model.patchSessionState({ lastChatId: 'chat' })
    expect(callFunction).not.toHaveBeenCalled()
  })

  it('stores a patch over the current config and exposes the result', async () => {
    const { model, callFunction } = setup()
    await model.loadDesktopState()
    const base = model.userConfig.value
    const editor = { ...base.editor, diffViewMode: 'split' as const }
    callFunction.mockResolvedValueOnce(
      response(1, { userConfig: { ...base, editor } })
    )
    expect((await model.updateUserConfig({ editor })).success).toBe(true)
    expect(callFunction).toHaveBeenCalledWith('saveUserConfig', [
      { ...base, editor },
      base,
    ])
    expect(model.userConfig.value.editor.diffViewMode).toBe('split')
  })

  it('uses detached browser state without invoking the backend', async () => {
    const { model, invoke } = setup(false)
    expect((await model.loadDesktopState()).revision).toBe(0)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not replace newer settings with a delayed save response', async () => {
    const { model, callFunction } = setup()
    await model.loadDesktopState()
    let finish!: (value: IpcResult<DesktopSnapshot>) => void
    callFunction.mockImplementationOnce(
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
    const { model, callFunction } = setup()
    await model.loadDesktopState()
    const failure = {
      success: false as const,
      error: 'Conflict',
      errorCode: 'configConflict' as const,
    }
    callFunction.mockResolvedValueOnce(failure)
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
    const { model, callFunction } = setup()
    await model.loadDesktopState()
    let finish!: (value: IpcResult<DesktopSnapshot>) => void
    callFunction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    callFunction.mockResolvedValueOnce(
      response(2, {
        sessionState: { lastChatId: 'chat', recentAiPrompts: ['original'] },
      })
    )
    const first = model.patchSessionState({ lastChatId: 'chat' })
    const prompts = ['original']
    const second = model.patchSessionState({ recentAiPrompts: prompts })
    prompts.push('later')
    await Promise.resolve()
    expect(callFunction).toHaveBeenCalledTimes(1)
    finish(response(1, { sessionState: { lastChatId: 'chat' } }))
    await Promise.all([first, second])
    expect(callFunction).toHaveBeenLastCalledWith('patchSessionState', [
      { recentAiPrompts: ['original'] },
    ])
    expect(model.desktopState.value.sessionState).toEqual({
      lastChatId: 'chat',
      recentAiPrompts: ['original'],
    })
  })

  it('preserves a newer event while a patch is pending', async () => {
    const { model, callFunction } = setup()
    await model.loadDesktopState()
    let finish!: (value: IpcResult<DesktopSnapshot>) => void
    callFunction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = model.patchSessionState({ lastChatId: 'old' })
    await Promise.resolve()
    model.applyViewState(view(3, { sessionState: { lastChatId: 'new' } }))
    finish(response(2, { sessionState: { lastChatId: 'old' } }))
    await pending
    expect(model.desktopState.value.sessionState.lastChatId).toBe('new')
  })

  it('continues processing queued patches after failure', async () => {
    const { model, callFunction, invoke } = setup()
    await model.loadDesktopState()
    callFunction.mockResolvedValueOnce({ success: false, error: 'Disk error' })
    callFunction.mockResolvedValueOnce(
      response(1, { sessionState: { lastChatId: 'saved' } })
    )
    expect(
      (await model.patchSessionState({ lastChatId: 'failed' })).success
    ).toBe(false)
    await model.patchSessionState({ lastChatId: 'saved' })
    expect(model.desktopState.value.sessionState.lastChatId).toBe('saved')
    expect(invoke).toHaveBeenCalledWith(DESKTOP_COMMANDS.GET_DESKTOP_STATE)
  })
})
