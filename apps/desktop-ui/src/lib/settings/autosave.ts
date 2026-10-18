import { ref } from 'vue'

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface AutosaveDependencies {
  /** Stores the current value; the caller reads it at the time of saving */
  save: () => Promise<void>
  delayMs: number
  setTimer?: (run: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/**
 * Saves a field a moment after the last change. Saves never overlap: a change
 * made during one is saved after it
 */
export function createAutosave(deps: AutosaveDependencies) {
  const setTimer =
    deps.setTimer ?? ((run, delayMs) => globalThis.setTimeout(run, delayMs))
  const clearTimer =
    deps.clearTimer ??
    ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>))
  const status = ref<AutosaveStatus>('idle')
  const error = ref('')
  let timer: unknown = null
  let running: Promise<void> | null = null
  let isDirty = false

  const run = async (): Promise<void> => {
    if (running) {
      await running
      return isDirty ? run() : undefined
    }
    if (!isDirty) return
    isDirty = false
    status.value = 'saving'
    running = deps.save().then(
      () => {
        status.value = isDirty ? 'pending' : 'saved'
        error.value = ''
      },
      (cause: unknown) => {
        status.value = 'error'
        error.value = cause instanceof Error ? cause.message : String(cause)
      }
    )
    try {
      await running
    } finally {
      running = null
    }
    if (isDirty && timer === null) await run()
  }

  /** A change to save once the field rests */
  const schedule = () => {
    isDirty = true
    status.value = 'pending'
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => {
      timer = null
      void run()
    }, deps.delayMs)
  }

  /** Saves a waiting change now, e.g. when the page is left */
  const flush = async () => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
    await run()
  }

  /** Forgets a waiting change, e.g. of a removed item */
  const cancel = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
    isDirty = false
    if (status.value === 'pending') status.value = 'idle'
  }

  return { status, error, schedule, flush, cancel }
}

export type Autosave = ReturnType<typeof createAutosave>

/** What a page with several autosaved parts shows: the worst state first */
export type AutosaveSummary = 'error' | 'saving' | 'saved' | ''

export function summarizeAutosave(
  statuses: readonly AutosaveStatus[]
): AutosaveSummary {
  if (statuses.includes('error')) return 'error'
  if (statuses.includes('saving') || statuses.includes('pending'))
    return 'saving'
  if (statuses.includes('saved')) return 'saved'
  return ''
}
