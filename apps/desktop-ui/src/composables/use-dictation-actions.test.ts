import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  refreshSecrets: vi.fn().mockResolvedValue(undefined),
  secrets: {} as Record<string, { origins: string[]; available: boolean }>,
  provider: 'deepgram',
}))

vi.mock('../stores/desktop', () => ({
  useDesktopStore: () => ({
    userConfig: {
      stt: {
        provider: mocks.provider,
        isVoiceCorrectionEnabled: false,
        providers: {
          deepgram: { modelId: 'nova-3', language: 'auto' },
          sherpaOnnx: { baseUrl: 'ws://localhost:6006' },
        },
      },
      language: { ui: 'auto' },
    },
  }),
}))
vi.mock('../stores/secrets', () => ({ useSecretsStore: () => mocks }))
vi.mock('../stores/llm', () => ({ useLlmStore: () => ({ actions: {} }) }))
vi.mock('../stores/translation', () => ({ useTranslationStore: () => ({}) }))
vi.mock('../lib/stt/live-dictation', () => ({
  createLiveDictation: () => ({
    start: mocks.start,
    cancel: vi.fn(async () => {}),
  }),
}))
vi.mock('./use-toast', () => ({
  default: () => ({ toastKey: vi.fn(), toastText: vi.fn() }),
}))

import { setI18nLocale } from '../lib/i18n/index'
import { useDictationActions } from './use-dictation-actions'

describe('dictation credential preflight', () => {
  let pinia: ReturnType<typeof createPinia>
  afterEach(() => disposePinia(pinia))
  const handlers = { onText: vi.fn(), onError: vi.fn() }

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mocks.provider = 'deepgram'
    mocks.secrets = {}
    mocks.refreshSecrets.mockResolvedValue(undefined)
    setI18nLocale('en-US')
  })

  it('explains how to configure a missing key before starting capture', async () => {
    await expect(
      useDictationActions().startDictation(handlers)
    ).rejects.toThrow('Open Settings → STT')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('explains how to unlock an inaccessible saved key', async () => {
    mocks.secrets = { 'stt.deepgram': { origins: [], available: false } }
    await expect(
      useDictationActions().startDictation(handlers)
    ).rejects.toThrow('Unlock the system keychain')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('explains a failed key status lookup', async () => {
    mocks.refreshSecrets.mockRejectedValue('Command undefined not found')
    await expect(
      useDictationActions().startDictation(handlers)
    ).rejects.toThrow('Could not check the API key')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('starts capture with a usable key', async () => {
    mocks.secrets = { 'stt.deepgram': { origins: [], available: true } }
    await useDictationActions().startDictation(handlers)
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ hasApiKey: true })
    )
  })

  it('starts a self-hosted provider without checking keys', async () => {
    mocks.provider = 'sherpaOnnx'
    await useDictationActions().startDictation(handlers)
    expect(mocks.refreshSecrets).not.toHaveBeenCalled()
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ hasApiKey: false })
    )
  })
})
