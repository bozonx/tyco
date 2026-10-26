import { DESKTOP_EVENTS } from '@tyco/shared'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { desktopClient } from '../lib/desktop/client'

/** How often the shown recording duration is updated */
const DURATION_TICK_MS = 250

/** Tracks audio level, peak, and elapsed recording duration for a voice session. */
export function useVoiceRecordingMeter(isRecording: () => boolean) {
  const audioLevel = ref(0)
  const audioPeak = ref(0)
  const recordingDurationMs = ref(0)

  let durationTimer: ReturnType<typeof setInterval> | undefined
  watch(
    isRecording,
    (recording) => {
      if (durationTimer) clearInterval(durationTimer)
      durationTimer = undefined
      if (!recording) {
        audioLevel.value = 0
        audioPeak.value = 0
        return
      }
      const startedAt = Date.now()
      recordingDurationMs.value = 0
      durationTimer = setInterval(() => {
        recordingDurationMs.value = Date.now() - startedAt
      }, DURATION_TICK_MS)
    },
    { immediate: true }
  )

  let unlisten: (() => void)[] = []
  let unmounted = false
  const keep = (stop: () => void) => {
    if (unmounted) stop()
    else unlisten.push(stop)
  }

  onMounted(() => {
    // the level meter is decoration: the recording must not wait for it
    void desktopClient
      .listen(DESKTOP_EVENTS.VOICE_AUDIO_LEVEL, (payload) => {
        // the microphone may be recording for another window
        if (!isRecording()) return
        audioLevel.value = payload.level
        audioPeak.value = payload.peak
      })
      .then(keep)
      .catch(() => undefined)
  })

  onUnmounted(() => {
    unmounted = true
    for (const stop of unlisten) stop()
    unlisten = []
    if (durationTimer) clearInterval(durationTimer)
  })

  return { audioLevel, audioPeak, recordingDurationMs }
}
