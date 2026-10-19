import type { SttProvider } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { assertSttKeyAvailable } from './stt-readiness'

describe('STT key readiness', () => {
  const translate = vi.fn(
    (key: string, params?: Record<string, string | number>) =>
      `${key}: ${params?.provider}`
  )

  it('accepts a usable stored key', () => {
    expect(() =>
      assertSttKeyAvailable(
        {
          'stt.deepgram': {
            origins: ['https://api.deepgram.com'],
            available: true,
          },
        },
        'deepgram',
        translate
      )
    ).not.toThrow()
    expect(translate).not.toHaveBeenCalled()
  })

  it('explains which provider needs a key', () => {
    expect(() => assertSttKeyAvailable({}, 'deepgram', translate)).toThrow(
      'toast.voiceKeyMissing: deepgram'
    )
  })

  it('distinguishes an inaccessible saved key from a missing key', () => {
    expect(() =>
      assertSttKeyAvailable(
        {
          'stt.deepgram': {
            origins: ['https://api.deepgram.com'],
            available: false,
          },
        },
        'deepgram',
        translate
      )
    ).toThrow('toast.voiceKeyUnavailable: deepgram')
  })

  it('does not accept inherited properties as saved keys', () => {
    expect(() =>
      assertSttKeyAvailable({}, 'toString' as SttProvider, translate)
    ).toThrow('toast.voiceKeyMissing: toString')
  })
})
