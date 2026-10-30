import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'
import { disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  refreshSecrets: vi.fn().mockResolvedValue(undefined),
  secrets: {} as Record<string, { origins: string[]; available: boolean }>,
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
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import { useDictationActions } from './use-dictation-actions'

describe('dictation credential preflight', () => {
  let desktop: TestDesktop
  afterEach(() => {
    disposePinia(desktop.pinia)
    desktop.dispose()
  })
  const loadWith = async (provider: UserConfig['stt']['provider']) => {
    desktop?.dispose()
    const userConfig = structuredClone(DEFAULT_USER_CONFIG) as UserConfig
    userConfig.stt.provider = provider
    userConfig.stt.isVoiceCorrectionEnabled = false
    desktop = await loadFakeDesktop({ userConfig })
  }
  const handlers = { onText: vi.fn(), onError: vi.fn() }

  beforeEach(async () => {
    vi.clearAllMocks()
    await loadWith('deepgram')
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
    await loadWith('sherpaOnnx')
    await useDictationActions().startDictation(handlers)
    expect(mocks.refreshSecrets).not.toHaveBeenCalled()
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ hasApiKey: false })
    )
  })
})
