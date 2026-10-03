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
})
