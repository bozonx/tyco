import { ref } from 'vue'

import {
  DEFAULT_PLAYBACK_RATE,
  readStoredPlaybackRate,
  writeStoredPlaybackRate,
} from '../lib/history/audio-playback-rate'

const sharedPlaybackRate = ref<number>(
  typeof window !== 'undefined' && window.localStorage
    ? readStoredPlaybackRate(window.localStorage)
    : DEFAULT_PLAYBACK_RATE
)

export function useAudioPlaybackRate() {
  function setPlaybackRate(rate: number) {
    sharedPlaybackRate.value = rate
    if (typeof window !== 'undefined' && window.localStorage) {
      writeStoredPlaybackRate(window.localStorage, rate)
    }
  }

  return { playbackRate: sharedPlaybackRate, setPlaybackRate }
}
