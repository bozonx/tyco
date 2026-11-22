import { DESKTOP_EVENTS } from '@tyco/shared'
import { onScopeDispose, readonly, ref } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import { createSoundCaptureActivity } from '../lib/voice/sound-capture-activity'

/** Whether TyCo records sound right now, in any window */
export function useSoundCaptureActivity() {
  const isActive = ref(false)
  const activity = createSoundCaptureActivity({
    onChange: (next) => {
      isActive.value = next
    },
  })
  let isDisposed = false
  let unlisten: (() => void) | undefined
  void desktopClient
    .listen(DESKTOP_EVENTS.VOICE_AUDIO_LEVEL, () => activity.onLevel())
    .then((stop) => {
      if (isDisposed) stop()
      else unlisten = stop
    })
    .catch(() => undefined)
  onScopeDispose(() => {
    isDisposed = true
    unlisten?.()
    activity.dispose()
  })
  return readonly(isActive)
}
