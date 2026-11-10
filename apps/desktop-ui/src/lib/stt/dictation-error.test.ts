import { describe, expect, it } from 'vitest'

import {
  asDictationError,
  describeDictationError,
  DictationError,
  isRetryableDictationError,
  isSettingsFixableDictationError,
} from './dictation-error'

describe('dictation-error', () => {
  const translate = (key: string) => key

  it('classifies network and connection failures as connection errors without raw IO noise', () => {
    const dnsError = asDictationError(
      'provider',
      new Error(
        'IO error: failed to lookup address information: Temporary failure in name resolution'
      )
    )
    expect(dnsError.kind).toBe('connection')
    expect(describeDictationError(dnsError, translate)).toBe(
      'toast.sttConnectionFailed'
    )
    expect(isRetryableDictationError(dnsError)).toBe(true)
    expect(isSettingsFixableDictationError(dnsError)).toBe(false)

    const timeoutError = asDictationError(
      'provider',
      new Error('WebSocket handshake timed out')
    )
    expect(timeoutError.kind).toBe('connection')
    expect(describeDictationError(timeoutError, translate)).toBe(
      'toast.sttConnectionFailed'
    )
  })

  it('classifies connection refused as localServerUnavailable', () => {
    const refused = asDictationError(
      'provider',
      new Error('IO error: Connection refused (os error 111)')
    )
    expect(refused.kind).toBe('localServerUnavailable')
    expect(describeDictationError(refused, translate)).toBe(
      'toast.sttLocalServerUnavailable'
    )
    expect(isSettingsFixableDictationError(refused)).toBe(true)
    expect(isRetryableDictationError(refused)).toBe(true)
  })

  it('classifies 401/403 credentials failures as auth errors fixable in settings', () => {
    const auth = asDictationError(
      'provider',
      new Error('HTTP error: 401 Unauthorized')
    )
    expect(auth.kind).toBe('auth')
    expect(describeDictationError(auth, translate)).toBe('toast.sttAuthFailed')
    expect(isSettingsFixableDictationError(auth)).toBe(true)
    expect(isRetryableDictationError(auth)).toBe(false)
  })

  it('preserves translated message for missingKey and keyUnavailable', () => {
    const missing = new DictationError('missingKey', 'Missing Deepgram key')
    expect(describeDictationError(missing, translate)).toBe(
      'Missing Deepgram key'
    )
    expect(isSettingsFixableDictationError(missing)).toBe(true)
    expect(isRetryableDictationError(missing)).toBe(false)

    const locked = new DictationError('keyUnavailable', 'Keychain locked')
    expect(describeDictationError(locked, translate)).toBe('Keychain locked')
    expect(isSettingsFixableDictationError(locked)).toBe(false)
  })
})
