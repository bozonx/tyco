import { START_MODES } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { APP_ROUTES, type AppRoutePath } from '../navigation/routes'
import {
  createVoiceChatActivation,
  type VoiceChatActivationParams,
} from './voice-chat-activation'

function setup(
  options: { path?: AppRoutePath; voiceInputOpen?: boolean } = {}
) {
  const calls: string[] = []
  let path = options.path ?? APP_ROUTES.CHAT.path
  const deps = {
    isVoiceInputOpen: vi.fn(() => options.voiceInputOpen ?? false),
    currentPath: () => path,
    startCleanChat: vi.fn(async () => {
      calls.push('newChat')
      path = APP_ROUTES.CHAT.path
    }),
    closeAllModals: vi.fn(() => calls.push('closeAll')),
    openQuickVoiceInput: vi.fn(() => calls.push('open')),
    submitVoiceInput: vi.fn(() => calls.push('submit')),
    attachSelection: vi.fn((text: string) => calls.push(`attach:${text}`)),
  }

  return { activation: createVoiceChatActivation(deps), deps, calls }
}

const params = (
  overrides: Partial<VoiceChatActivationParams> = {}
): VoiceChatActivationParams => ({
  activationId: 1,
  mode: START_MODES.VOICE_CHAT,
  isWindowShown: true,
  ...overrides,
})

describe('createVoiceChatActivation', () => {
  it('asks a question from another application in a new chat', async () => {
    const { activation, calls } = setup()

    expect(await activation.apply(params())).toBe(true)
    expect(calls).toEqual(['closeAll', 'newChat', 'open'])
  })

  it('starts a new chat from another screen', async () => {
    const { activation, calls } = setup({ path: APP_ROUTES.EDITOR.path })

    await activation.apply(params({ mode: START_MODES.EDITOR }))
    await activation.apply(params({ activationId: 2 }))

    expect(calls).toEqual(['closeAll', 'newChat', 'open'])
  })

  it('follows up on the chat in view', async () => {
    const { activation, calls } = setup()

    await activation.apply(params({ mode: START_MODES.CHAT }))
    await activation.apply(params({ activationId: 2 }))

    expect(calls).toEqual(['closeAll', 'open'])
  })

  it('starts a new chat when the window was hidden', async () => {
    const { activation, calls } = setup()

    await activation.apply(params({ mode: START_MODES.CHAT }))
    await activation.apply(params({ isWindowShown: false }))
    await activation.apply(params({ activationId: 2 }))

    expect(calls).toEqual(['closeAll', 'newChat', 'open'])
  })

  it('submits the dictation when the voice input is already open', async () => {
    const { activation, calls } = setup({ voiceInputOpen: true })

    await activation.apply(params())

    expect(calls).toEqual(['submit'])
  })

  it('replaces a voice input open on another screen', async () => {
    const { activation, calls } = setup({
      path: APP_ROUTES.EDITOR.path,
      voiceInputOpen: true,
    })

    await activation.apply(params())

    expect(calls).toEqual(['closeAll', 'newChat', 'open'])
  })

  it('handles each activation once', async () => {
    const { activation, deps } = setup()

    await activation.apply(params())
    expect(await activation.apply(params())).toBe(false)
    await activation.apply(params({ activationId: 2 }))

    expect(deps.openQuickVoiceInput).toHaveBeenCalledTimes(2)
  })

  it('ignores other modes and a hidden window', async () => {
    const { activation, calls } = setup()

    expect(await activation.apply(params({ mode: START_MODES.CHAT }))).toBe(
      false
    )
    expect(await activation.apply(params({ isWindowShown: false }))).toBe(false)
    expect(calls).toEqual([])
  })

  it('attaches the selection captured with the activation', async () => {
    const { activation, calls } = setup()

    await activation.apply(params({ selectedText: ' Selected ' }))

    expect(calls).toEqual(['closeAll', 'newChat', 'attach:Selected', 'open'])
  })

  it('gives a selection arriving meanwhile to the new chat', async () => {
    const { activation, deps, calls } = setup()
    let chatReady: () => void = () => {}
    deps.startCleanChat.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          calls.push('newChat')
          chatReady = resolve
        })
    )

    const opening = activation.apply(params())
    await activation.apply(params({ selectedText: 'Late' }))
    chatReady()
    await opening

    expect(calls).toEqual(['closeAll', 'newChat', 'attach:Late', 'open'])
  })

  it('attaches a selection that arrives after the activation once', async () => {
    const { activation, deps } = setup()

    await activation.apply(params())
    expect(await activation.apply(params({ selectedText: 'Late' }))).toBe(false)
    await activation.apply(params({ selectedText: 'Late' }))

    expect(deps.attachSelection).toHaveBeenCalledOnce()
    expect(deps.attachSelection).toHaveBeenCalledWith('Late')
  })

  it('does not attach a selection to the press that submits', async () => {
    const { activation, deps } = setup({ voiceInputOpen: true })

    await activation.apply(params({ selectedText: 'Selected' }))
    await activation.apply(params({ selectedText: 'Selected' }))

    expect(deps.submitVoiceInput).toHaveBeenCalledOnce()
    expect(deps.attachSelection).not.toHaveBeenCalled()
  })
})
