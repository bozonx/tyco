import { DEFAULT_USER_CONFIG, TRANSLATION_SECRET_IDS } from '@tyco/shared'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createInvocationRunner } from '../lib/invocation/invocation-runner'
import { useDesktopStore } from './desktop'
import { useInvocationRunnerDependencies } from './invocations'
import { useIpcStore } from './ipc'
import { appNavigation } from '../navigation'
import { useChatStore } from './chat'
import { useSecretsStore } from './secrets'
import { useToolsStore } from './tools'
import { useToastStore } from './toast'

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => disposePinia(pinia))

describe('core insertion dependency wiring', () => {
  it('returns failure and reports once when the native paste fails', async () => {
    const ipc = useIpcStore()
    const call = vi
      .spyOn(ipc, 'call')
      .mockResolvedValueOnce({ success: false, error: 'Target unavailable' })
      .mockResolvedValue({ success: true, result: undefined })
    const toast = vi.spyOn(useToastStore(), 'addToast')
    const runner = createInvocationRunner(useInvocationRunnerDependencies())
    const outcome = await runner.run(
      { toolId: 'core.insert', toolConfig: {}, label: 'Insert' },
      'Hello'
    )
    expect(outcome.success).toBe(false)
    expect(outcome.message).toContain('Target unavailable')
    expect(call).toHaveBeenCalledWith('paste_into_target_and_hide', {
      text: 'Hello',
    })
    expect(call).toHaveBeenCalledWith('show_desktop_notification', {
      summary: expect.any(String),
      body: 'Target unavailable',
    })
    expect(toast).toHaveBeenCalledOnce()
  })
})

describe('ask in chat', () => {
  const askInChat = () =>
    useToolsStore()
      .get('core.askInChat')!
      .run({
        input: { text: 'Context' },
        config: {},
        source: 'menu',
        signal: new AbortController().signal,
        isOutputRequested: false,
      })

  it('attaches the text to "Ask AI", which provides itself', async () => {
    vi.spyOn(appNavigation, 'push').mockResolvedValue()
    const chat = useChatStore()
    expect((await askInChat()).ok).toBe(true)
    expect(chat.currentChatParams.attachments).toEqual([
      expect.objectContaining({ text: 'Context' }),
    ])
  })

  it('is released with the chat that provided it', async () => {
    const release = useToolsStore().provideAskInChat(async () => {})
    release()
    await expect(askInChat()).rejects.toThrow('The chat is not available')
  })
})

describe('translator availability', () => {
  it('reports missing API key when machine provider is active without a usable secret', () => {
    const desktop = useDesktopStore()
    desktop.applyViewState({
      ...desktop.desktopState,
      userConfig: {
        ...DEFAULT_USER_CONFIG,
        translation: { ...DEFAULT_USER_CONFIG.translation, provider: 'deepl' },
      },
    })
    const secrets = useSecretsStore()
    secrets.secrets = {}

    const tool = useToolsStore().get('core.translate')
    expect(tool?.getUnavailableReasonKey?.()).toBe('tools.noApiKey')

    secrets.secrets = {
      [TRANSLATION_SECRET_IDS.deepl]: { available: true, origins: [] },
    }
    expect(tool?.getUnavailableReasonKey?.()).toBeUndefined()
  })
})
