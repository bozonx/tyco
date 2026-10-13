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
      sttModels: DEFAULT_USER_CONFIG.sttModels,
      aiModelUsage: { stt: 'deepgram-stt' },
    })
  })

  it('keeps one model per known provider with the user settings', () => {
    const config = normalizeSttConfig({
      sttModels: [
        { id: 'assemblyai-stt', provider: 'assemblyai' },
        { id: 'deepgram-stt', provider: 'deepgram', model: 'nova-3-general' },
        {
          id: 'custom',
          provider: 'sherpa-onnx',
          baseUrl: 'ws://speech.lan:6006',
        },
      ],
      aiModelUsage: { stt: 'assemblyai-stt' },
    })

    expect(config.sttModels).toMatchObject([
      { id: 'deepgram-stt', provider: 'deepgram', model: 'nova-3-general' },
      {
        id: 'sherpa-onnx-stt',
        provider: 'sherpa-onnx',
        baseUrl: 'ws://speech.lan:6006',
      },
    ])
    expect(config.aiModelUsage.stt).toBe('deepgram-stt')
  })

  it('rejects invalid field types without losing valid provider settings', () => {
    const config = normalizeSttConfig({
      sttModels: [
        null,
        [],
        {
          provider: 'deepgram',
          model: null,
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
      aiModelUsage: { stt: ['deepgram-stt'] },
    })
    expect(config.sttModels[0]).toEqual(DEFAULT_USER_CONFIG.sttModels[0])
    expect(config.sttModels[1]).toMatchObject({
      baseUrl: 'ws://speech.lan:6006',
      formatWithLlm: true,
    })
    expect(config.aiModelUsage.stt).toBe('deepgram-stt')
    expect(activeSttModel(config).model.trim()).toBe('nova-3')
  })

  it.each([null, [], 'invalid', 42])(
    'accepts malformed sections: %j',
    (input) => {
      expect(normalizeSttConfig(input)).toEqual(normalizeSttConfig({}))
    }
  )

  it('keeps the chosen provider', () => {
    const config = normalizeSttConfig({
      aiModelUsage: { stt: 'sherpa-onnx-stt' },
    })

    expect(activeSttModel(config).provider).toBe('sherpa-onnx')
  })
})

describe('selectSttProvider', () => {
  it('switches dictation to the model of the provider', () => {
    const config = normalizeSttConfig({})

    selectSttProvider(config, 'sherpa-onnx')

    expect(config.aiModelUsage.stt).toBe('sherpa-onnx-stt')
    expect(activeSttModel(config).baseUrl).toBe('ws://localhost:6006')
  })

  it('preserves formatWithLlm when switching provider', () => {
    const config = normalizeSttConfig({})
    activeSttModel(config).formatWithLlm = true

    selectSttProvider(config, 'sherpa-onnx')

    expect(config.aiModelUsage.stt).toBe('sherpa-onnx-stt')
    expect(activeSttModel(config).formatWithLlm).toBe(true)
  })
})
