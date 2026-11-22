import type { ControlOption } from '../ui/control-option'

export const PLAYBACK_RATE_STORAGE_KEY = 'tyco:audio-playback-rate'
export const DEFAULT_PLAYBACK_RATE = 1

export const SPEED_OPTIONS: ControlOption<number>[] = [
  { id: 1, name: '1×' },
  { id: 1.5, name: '1.5×' },
  { id: 2, name: '2×' },
]

export function readStoredPlaybackRate(
  storage?: Pick<Storage, 'getItem'> | null
): number {
  if (!storage) return DEFAULT_PLAYBACK_RATE
  try {
    const raw = storage.getItem(PLAYBACK_RATE_STORAGE_KEY)
    if (!raw) return DEFAULT_PLAYBACK_RATE
    const parsed = Number(raw)
    return SPEED_OPTIONS.some((opt) => opt.id === parsed)
      ? parsed
      : DEFAULT_PLAYBACK_RATE
  } catch {
    return DEFAULT_PLAYBACK_RATE
  }
}

export function writeStoredPlaybackRate(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  rate: number
): void {
  if (!storage) return
  try {
    storage.setItem(PLAYBACK_RATE_STORAGE_KEY, String(rate))
  } catch {
    // Ignore storage quota or security errors
  }
}
