import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  refreshSecrets: vi.fn().mockResolvedValue(undefined),
  secrets: {} as Record<string, { origins: string[]; available: boolean }>,
  provider: 'deepgram',
}))

vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({
    params: {
      userConfig: {
        aiModelUsage: { stt: 'speech' },
        sttModels: [
          {
            id: 'speech',
            provider: mocks.provider,
            model: 'nova-3',
            baseUrl: 'ws://localhost:6006',
          },
        ],
        userLanguage: 'en_US',
      },
    },
  }),
}))
vi.mock('../stores/llm', () => ({ useLlmStore: () => mocks }))
vi.mock('../stores/translation', () => ({ useTranslationStore: () => ({}) }))
vi.mock('../lib/stt/live-dictation', () => ({
  createLiveDictation: () => ({ start: mocks.start }),
}))
vi.mock('./use-toast', () => ({
  default: () => ({ toast: vi.fn(), toastText: vi.fn() }),
}))

import { setI18nLocale } from '../lib/i18n/index'
import { useCallAi } from './use-call-ai'

describe('dictation credential preflight', () => {
  const handlers = { onText: vi.fn(), onError: vi.fn() }

  beforeEach(() => {
    mocks.provider = 'deepgram'
    mocks.secrets = {}
    mocks.refreshSecrets.mockResolvedValue(undefined)
    setI18nLocale('en_US')
  })

  it('explains how to configure a missing key before starting capture', async () => {
    await expect(useCallAi().startDictation(handlers)).rejects.toThrow(
      'Open Settings → STT'
    )
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('explains how to unlock an inaccessible saved key', async () => {
    mocks.secrets = { deepgram: { origins: [], available: false } }
    await expect(useCallAi().startDictation(handlers)).rejects.toThrow(
      'Unlock the system keychain'
    )
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('explains a failed key status lookup', async () => {
    mocks.refreshSecrets.mockRejectedValue('Command undefined not found')
    await expect(useCallAi().startDictation(handlers)).rejects.toThrow(
      'Could not check the API key'
    )
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('starts capture with a usable key', async () => {
    mocks.secrets = { deepgram: { origins: [], available: true } }
    await useCallAi().startDictation(handlers)
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ hasApiKey: true })
    )
  })

  it('starts a self-hosted provider without checking keys', async () => {
    mocks.provider = 'sherpa-onnx'
    await useCallAi().startDictation(handlers)
    expect(mocks.refreshSecrets).not.toHaveBeenCalled()
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ hasApiKey: false })
    )
  })
})
