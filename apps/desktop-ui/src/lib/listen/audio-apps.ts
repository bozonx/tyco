import type { AudioApp, AudioAppsEvent } from '@tyco/shared'

import type { NetIpc } from '../net/net-ipc'

/** Watches the applications that play sound until `stop` */
export interface AudioAppsWatch {
  stop: () => void
}

/**
 * Lists the applications that play sound, now and as they change, see
 * `services/voice/apps.rs`. The backend follows the streams only while a watch
 * runs.
 */
export async function watchAudioApps(
  ipc: NetIpc,
  onApps: (apps: AudioApp[]) => void
): Promise<AudioAppsWatch> {
  let isStopped = false
  const watchId = await ipc.invoke('watch_audio_apps', {
    onApps: ipc.createChannel((message: unknown) => {
      const event = message as AudioAppsEvent
      if (!isStopped && event.type === 'apps') onApps(event.apps)
    }),
  })
  return {
    stop: () => {
      if (isStopped) return
      isStopped = true
      void ipc.invoke('unwatch_audio_apps', { watchId }).catch(() => undefined)
    },
  }
}

/** A level from 0 to 1 as three bars, e.g. `▮▮▯` */
export function levelBars(level: number, count = 3): string {
  const filled = Math.min(count, Math.max(0, Math.ceil(level * count * 1.5)))
  return '▮'.repeat(filled) + '▯'.repeat(count - filled)
}
