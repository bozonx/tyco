import { describe, expect, it } from 'vitest'

import {
  activeSttModel,
  normalizeSttConfig,
  selectSttProvider,
} from './stt-config'
import { DEFAULT_USER_CONFIG } from '@tyco/shared'

describe('normalizeSttConfig', () => {
  it('fills a missing section with the defaults', () => {
    expect(normalizeSttConfig({})).toEqual({
      models: DEFAULT_USER_CONFIG.stt.models,
      selectedModelId: 'deepgram-stt',
    })
  })

  it('keeps one model per known provider with the user settings', () => {
    const config = normalizeSttConfig({
      models: [
        { id: 'assemblyai-stt', provider: 'assemblyai' },
        {
          id: 'deepgram-stt',
          provider: 'deepgram',
          providerModelId: 'nova-3-general',
        },
        {
          id: 'custom',
          provider: 'sherpa-onnx',
          baseUrl: 'ws://speech.lan:6006',
        },
      ],
      selectedModelId: 'assemblyai-stt',
    })

    expect(config.models).toMatchObject([
      {
        id: 'deepgram-stt',
        provider: 'deepgram',
        providerModelId: 'nova-3-general',
      },
      {
        id: 'sherpa-onnx-stt',
        provider: 'sherpa-onnx',
        baseUrl: 'ws://speech.lan:6006',
      },
    ])
    expect(config.selectedModelId).toBe('deepgram-stt')
  })

  it('rejects invalid field types without losing valid provider settings', () => {
    const config = normalizeSttConfig({
      models: [
        null,
        [],
        {
          provider: 'deepgram',
          providerModelId: null,
          description: 7,
          language: {},
          formatWithLlm: 'false',
          baseUrl: 42,
        },
        {
          provider: 'sherpa-onnx',
          baseUrl: 'ws://speech.lan:6006',
          formatWithLlm: true,
        },
      ],
      selectedModelId: ['deepgram-stt'],
    })
    expect(config.models[0]).toEqual(DEFAULT_USER_CONFIG.stt.models[0])
    expect(config.models[1]).toMatchObject({
      baseUrl: 'ws://speech.lan:6006',
      formatWithLlm: true,
    })
    expect(config.selectedModelId).toBe('deepgram-stt')
    expect(activeSttModel(config).providerModelId.trim()).toBe('nova-3')
  })

  it.each([null, [], 'invalid', 42])(
    'accepts malformed sections: %j',
    (input) => {
      expect(normalizeSttConfig(input)).toEqual(normalizeSttConfig({}))
    }
  )

  it('keeps the chosen provider', () => {
    const config = normalizeSttConfig({ selectedModelId: 'sherpa-onnx-stt' })

    expect(activeSttModel(config).provider).toBe('sherpa-onnx')
  })
})

describe('selectSttProvider', () => {
  it('switches dictation to the model of the provider', () => {
    const config = normalizeSttConfig({})

    selectSttProvider(config, 'sherpa-onnx')

    expect(config.selectedModelId).toBe('sherpa-onnx-stt')
    expect(activeSttModel(config).baseUrl).toBe('ws://localhost:6006')
  })

  it('preserves formatWithLlm when switching provider', () => {
    const config = normalizeSttConfig({})
    activeSttModel(config).formatWithLlm = true

    selectSttProvider(config, 'sherpa-onnx')

    expect(config.selectedModelId).toBe('sherpa-onnx-stt')
    expect(activeSttModel(config).formatWithLlm).toBe(true)
  })
})
