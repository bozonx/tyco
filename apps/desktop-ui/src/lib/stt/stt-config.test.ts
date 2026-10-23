import { describe, expect, it } from 'vitest'

import { activeSttModel } from './stt-config'
import { DEFAULT_USER_CONFIG, type SttConfig } from '@tyco/shared'

describe('activeSttModel', () => {
  it('runs on the chosen provider with its settings', () => {
    const config: SttConfig = structuredClone(DEFAULT_USER_CONFIG.stt)
    config.providers.deepgram = { modelId: 'nova-3-general', language: 'de-DE' }
    config.providers.sherpaOnnx = { baseUrl: 'ws://speech.lan:6006' }

    expect(activeSttModel(config)).toEqual({
      provider: 'deepgram',
      modelId: 'nova-3-general',
      language: 'de-DE',
    })
    config.provider = 'sherpaOnnx'
    expect(activeSttModel(config)).toEqual({
      provider: 'sherpaOnnx',
      modelId: 'sherpa-onnx',
      baseUrl: 'ws://speech.lan:6006',
    })
  })
})
