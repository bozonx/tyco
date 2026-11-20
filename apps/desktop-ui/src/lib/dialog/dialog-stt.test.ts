import { DEFAULT_USER_CONFIG, type SttConfig } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { DictationError } from '../stt/dictation-error'
import { resolveDialogStt } from './dialog-stt'

const translate = (key: string) => key

function config(patch: Partial<SttConfig> = {}): SttConfig {
  return { ...DEFAULT_USER_CONFIG.stt, ...patch }
}

describe('resolveDialogStt', () => {
  it('needs a usable key of the provider', async () => {
    await expect(
      resolveDialogStt({
        getConfig: () => config(),
        refreshSecrets: async () => undefined,
        getSecrets: () => ({}),
        translate,
      })
    ).rejects.toBeInstanceOf(DictationError)
  })

  it('transcribes the user in the dictation language and the other side in any', async () => {
    const refreshSecrets = vi.fn(async () => undefined)
    const stt = await resolveDialogStt({
      getConfig: () =>
        config({
          providers: {
            ...DEFAULT_USER_CONFIG.stt.providers,
            deepgram: { modelId: 'nova-3', language: 'de-DE' },
          },
        }),
      refreshSecrets,
      getSecrets: () => ({
        'stt.deepgram': {
          origins: ['https://api.deepgram.com'],
          available: true,
        },
      }),
      translate,
    })
    expect(refreshSecrets).toHaveBeenCalledOnce()
    expect(stt.hasApiKey).toBe(true)
    expect(stt.languageOf('me')).toBe('de')
    expect(stt.languageOf('remote')).toBeUndefined()
  })

  it('reports an incomplete model', async () => {
    await expect(
      resolveDialogStt({
        getConfig: () =>
          config({
            provider: 'sherpaOnnx',
            providers: {
              ...DEFAULT_USER_CONFIG.stt.providers,
              sherpaOnnx: { baseUrl: 'http://wrong' },
            },
          }),
        refreshSecrets: async () => undefined,
        getSecrets: () => ({}),
        translate,
      })
    ).rejects.toMatchObject({ kind: 'incompleteConfig' })
  })
})
