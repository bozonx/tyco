import { DEFAULT_USER_CONFIG, type SttModel } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import type { SecretsStatus } from '../net/secrets'
import { createDictationController } from './dictation-controller'
import type { LiveDictationStart } from './live-dictation'
import { createLiveTranscriptState } from './live-transcript'

function setup(
  model: SttModel = { id: 'voice', provider: 'deepgram', model: 'nova-3' }
) {
  const config = structuredClone(DEFAULT_USER_CONFIG)
  config.sttModels = [model]
  config.aiModelUsage.stt = model.id
  config.userLanguage = 'es_AR'
  const secrets: SecretsStatus = { deepgram: { origins: [], available: true } }
  const deps = {
    getConfig: () => config,
    dictation: {
      start: vi
        .fn<(request: LiveDictationStart) => Promise<void>>()
        .mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue('dictated text'),
      cancel: vi.fn().mockResolvedValue(undefined),
    },
    refreshSecrets: vi.fn().mockResolvedValue(undefined),
    getSecrets: () => secrets,
    translate: (key: string) => key,
    logError: vi.fn(),
  }
  const handlers = { onText: vi.fn(), onError: vi.fn() }
  return {
    config,
    secrets,
    deps,
    handlers,
    controller: createDictationController(deps),
  }
}

describe('dictation controller', () => {
  it('checks credentials before opening the microphone and resolves the user language', async () => {
    const { deps, handlers, controller } = setup()
    await controller.startDictation(handlers)
    expect(deps.refreshSecrets.mock.invocationCallOrder[0]).toBeLessThan(
      deps.dictation.start.mock.invocationCallOrder[0]
    )
    expect(deps.dictation.start).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { id: 'voice', provider: 'deepgram', model: 'nova-3' },
        language: 'es',
        hasApiKey: true,
        onText: handlers.onText,
      })
    )
  })

  it('rejects missing and unavailable keys before opening the microphone', async () => {
    const { secrets, deps, handlers, controller } = setup()
    secrets.deepgram.available = false
    await expect(controller.startDictation(handlers)).rejects.toThrow(
      'toast.voiceKeyUnavailable'
    )
    delete secrets.deepgram
    await expect(controller.startDictation(handlers)).rejects.toThrow(
      'toast.voiceKeyMissing'
    )
    expect(deps.dictation.start).not.toHaveBeenCalled()
  })

  it('reports a failed credential check without starting capture', async () => {
    const { deps, handlers, controller } = setup()
    deps.refreshSecrets.mockRejectedValue(new Error('Vault unavailable'))
    await expect(controller.startDictation(handlers)).rejects.toThrow(
      'toast.voiceKeyCheckFailed'
    )
    expect(deps.dictation.start).not.toHaveBeenCalled()
  })

  it('allows a keyless provider and follows an explicitly selected language', async () => {
    const { deps, handlers, controller } = setup({
      id: 'local',
      provider: 'sherpa-onnx',
      model: 'sherpa-onnx',
      baseUrl: 'ws://speech.lan:6006',
      language: 'tr_TR',
    })
    await controller.startDictation(handlers)
    expect(deps.refreshSecrets).not.toHaveBeenCalled()
    expect(deps.dictation.start).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'tr', hasApiKey: false })
    )
  })

  it('uses the latest configuration for each session and formatting preference', async () => {
    const { config, deps, handlers, controller } = setup()
    expect(controller.shouldFormatRecognizedText()).toBe(false)
    config.sttModels[0].formatWithLlm = true
    config.sttModels[0].language = 'en_US'
    expect(controller.shouldFormatRecognizedText()).toBe(true)
    await controller.startDictation(handlers)
    expect(deps.dictation.start).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en' })
    )
    config.aiModelUsage.stt = 'missing'
    await expect(controller.startDictation(handlers)).rejects.toThrow(
      'toast.modelNotFound'
    )
    expect(controller.shouldFormatRecognizedText()).toBe(false)
  })

  it('rejects an incomplete provider configuration before checking credentials', async () => {
    const { deps, handlers, controller } = setup({
      id: 'voice',
      provider: 'deepgram',
      model: '',
    })
    await expect(controller.startDictation(handlers)).rejects.toThrow(
      'toast.sttModelIncomplete'
    )
    expect(deps.refreshSecrets).not.toHaveBeenCalled()
    expect(deps.dictation.start).not.toHaveBeenCalled()
  })

  it('forwards transcript updates and logs session errors before delivering them', async () => {
    const { deps, handlers, controller } = setup()
    await controller.startDictation(handlers)
    const request = deps.dictation.start.mock.calls[0][0]
    const state = createLiveTranscriptState()
    request.onText(state)
    expect(handlers.onText).toHaveBeenCalledWith(state)
    const error = new Error('Stream closed')
    request.onError(error)
    expect(deps.logError).toHaveBeenCalledWith(
      'Speech recognition session failed',
      error
    )
    expect(handlers.onError).toHaveBeenCalledWith(error)
    expect(deps.logError.mock.invocationCallOrder[0]).toBeLessThan(
      handlers.onError.mock.invocationCallOrder[0]
    )
  })

  it('returns the final transcript and delegates cancellation', async () => {
    const { deps, controller } = setup()
    expect(await controller.finishDictation()).toBe('dictated text')
    await controller.cancelDictation()
    expect(deps.dictation.finish).toHaveBeenCalledOnce()
    expect(deps.dictation.cancel).toHaveBeenCalledOnce()
  })
})
