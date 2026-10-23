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
  const save = async () => deps.save()
  const status = ref<AutosaveStatus>('idle')
  const error = ref('')
  let timer: unknown = null
  let running: Promise<boolean> | null = null
  let revision = 0
  let changeCount = 0
  let isDirty = false

  const run = async (): Promise<boolean> => {
    if (running) {
      const saved = await running
      return saved && isDirty ? run() : saved
    }
    if (!isDirty) return status.value !== 'error'
    const savingRevision = revision
    const savingChangeCount = changeCount
    isDirty = false
    status.value = 'saving'
    running = save().then(
      () => {
        if (savingRevision === revision) {
          status.value = isDirty ? 'pending' : 'saved'
          error.value = ''
        }
        return true
      },
      (cause: unknown) => {
        if (savingRevision === revision) {
          isDirty = true
          status.value = 'error'
          error.value = cause instanceof Error ? cause.message : String(cause)
        }
        return false
      }
    )
    let saved: boolean
    try {
      saved = await running
    } finally {
      running = null
    }
    if (
      isDirty &&
      timer === null &&
      (saved || savingChangeCount !== changeCount)
    )
      return run()
    return saved
  }

  /** A change to save once the field rests */
  const schedule = () => {
    changeCount += 1
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
    return await run()
  }

  /** Forgets a waiting change, e.g. of a removed item */
  const cancel = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
    isDirty = false
    revision += 1
    status.value = 'idle'
    error.value = ''
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

/**
 * The state of saves that start at once, e.g. of a switch, shown the way an
 * autosave is. The last save to end decides between saved and failed
 */
export function createSaveTracker() {
  const status = ref<AutosaveStatus>('idle')
  const error = ref('')
  const running = new Set<Promise<boolean>>()

  const track = (save: Promise<unknown>): Promise<boolean> => {
    status.value = 'saving'
    const done = save.then(
      () => {
        error.value = ''
        return true
      },
      (cause: unknown) => {
        error.value = cause instanceof Error ? cause.message : String(cause)
        return false
      }
    )
    running.add(done)
    void done.then(() => {
      running.delete(done)
      if (running.size === 0) status.value = error.value ? 'error' : 'saved'
    })
    return done
  }

  /** Waits for the saves under way; false when the last one failed */
  const flush = async (): Promise<boolean> => {
    await Promise.all([...running])
    return !error.value
  }

  return { status, error, track, flush }
}
