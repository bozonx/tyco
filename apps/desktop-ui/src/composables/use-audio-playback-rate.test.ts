import { describe, expect, it } from 'vitest'

import { useAudioPlaybackRate } from './use-audio-playback-rate'
import { PLAYBACK_RATE_STORAGE_KEY } from '../lib/history/audio-playback-rate'

describe('use-audio-playback-rate', () => {
  it('updates shared rate and persists to storage', () => {
    const { playbackRate, setPlaybackRate } = useAudioPlaybackRate()
    setPlaybackRate(1.5)
    expect(playbackRate.value).toBe(1.5)
    expect(window.localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY)).toBe('1.5')

    const another = useAudioPlaybackRate()
    expect(another.playbackRate.value).toBe(1.5)

    // reset back
    setPlaybackRate(1)
    expect(playbackRate.value).toBe(1)
  })
})
