import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATE_STORAGE_KEY,
  readStoredPlaybackRate,
  writeStoredPlaybackRate,
} from './audio-playback-rate'

describe('audio-playback-rate', () => {
  it('falls back to default if storage is missing or invalid', () => {
    expect(readStoredPlaybackRate(null)).toBe(DEFAULT_PLAYBACK_RATE)

    const map = new Map<string, string>()
    const fakeStorage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
    }

    expect(readStoredPlaybackRate(fakeStorage)).toBe(DEFAULT_PLAYBACK_RATE)

    fakeStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, 'not-a-number')
    expect(readStoredPlaybackRate(fakeStorage)).toBe(DEFAULT_PLAYBACK_RATE)

    fakeStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, '-1')
    expect(readStoredPlaybackRate(fakeStorage)).toBe(DEFAULT_PLAYBACK_RATE)
  })

  it('reads and writes valid stored rate', () => {
    const map = new Map<string, string>()
    const fakeStorage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
    }

    writeStoredPlaybackRate(fakeStorage, 1.5)
    expect(map.get(PLAYBACK_RATE_STORAGE_KEY)).toBe('1.5')
    expect(readStoredPlaybackRate(fakeStorage)).toBe(1.5)
  })
})
