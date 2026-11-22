/**
 * How long after the last audio level a capture counts as over: a running
 * capture publishes its level every 40 ms, see `services/voice.rs`
 */
export const SOUND_CAPTURE_IDLE_MS = 500

export interface SoundCaptureActivityDependencies {
  /** Called when whether a capture runs changes */
  onChange: (isActive: boolean) => void
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
  idleMs?: number
}

export interface SoundCaptureActivity {
  /** An audio level of any capture, of any window, arrived */
  onLevel: () => void
  readonly isActive: boolean
  dispose: () => void
}

/**
 * Whether TyCo records sound right now, in any window: a dictation, listening
 * or a dialog. Told by the audio levels every capture publishes to all
 * windows.
 */
export function createSoundCaptureActivity(
  deps: SoundCaptureActivityDependencies
): SoundCaptureActivity {
  const startTimer =
    deps.setTimeout ??
    ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms))
  const stopTimer =
    deps.clearTimeout ??
    ((handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>))
  let isActive = false
  let timer: unknown

  const clear = () => {
    if (timer === undefined) return
    stopTimer(timer)
    timer = undefined
  }

  return {
    onLevel() {
      clear()
      timer = startTimer(() => {
        timer = undefined
        isActive = false
        deps.onChange(false)
      }, deps.idleMs ?? SOUND_CAPTURE_IDLE_MS)
      if (isActive) return
      isActive = true
      deps.onChange(true)
    },
    get isActive() {
      return isActive
    },
    dispose: clear,
  }
}
