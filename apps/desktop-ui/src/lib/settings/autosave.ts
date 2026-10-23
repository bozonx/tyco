import { errorMessage } from '@tyco/shared/value-guards'
import { computed, ref, watch, type Ref } from 'vue'

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

/** An autosave waits this long after the last keystroke */
export const AUTOSAVE_DELAY_MS = 600

/** When an autosave runs; tests pass their own timers */
export interface AutosaveTimers {
  /** Defaults to `AUTOSAVE_DELAY_MS` */
  delayMs?: number
  setTimer?: (run: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export interface AutosaveDependencies extends AutosaveTimers {
  /** Stores the current value; the caller reads it at the time of saving */
  save: () => Promise<void>
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
  const delayMs = deps.delayMs ?? AUTOSAVE_DELAY_MS
  // a save that throws at once fails the way a rejected one does
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
          // the message first: a watcher of the status reads it
          error.value = errorMessage(cause)
          status.value = 'error'
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
    }, delayMs)
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

export interface SaveTrackerDependencies {
  /** Stores the current value again, once a save has failed */
  resave: () => Promise<unknown>
}

/**
 * The state of saves that start at once, e.g. of a switch, shown the way an
 * autosave is. A failed save keeps the error until a flush stores the current
 * value again
 */
export function createSaveTracker(deps: SaveTrackerDependencies) {
  const status = ref<AutosaveStatus>('idle')
  const error = ref('')
  const running = new Set<Promise<boolean>>()
  let hasFailed = false

  const track = (save: Promise<unknown>): Promise<boolean> => {
    status.value = 'saving'
    const done = save.then(
      () => true,
      (cause: unknown) => {
        hasFailed = true
        error.value = errorMessage(cause)
        return false
      }
    )
    running.add(done)
    void done.then(() => {
      running.delete(done)
      if (running.size > 0) return
      status.value = hasFailed ? 'error' : 'saved'
      if (!hasFailed) error.value = ''
    })
    return done
  }

  /** Waits for the saves under way and retries a failed one; false when it fails */
  const flush = async (): Promise<boolean> => {
    await Promise.all([...running])
    if (hasFailed) {
      hasFailed = false
      await track(deps.resave())
      await Promise.all([...running])
    }
    return !hasFailed
  }

  /** Forgets a failure, e.g. of a removed item */
  const cancel = () => {
    hasFailed = false
    error.value = ''
    if (running.size === 0) status.value = 'idle'
  }

  return { status, error, track, flush, cancel }
}

/** One autosaved part of a page */
export interface AutosavePart {
  status: Readonly<Ref<AutosaveStatus>>
  error: Readonly<Ref<string>>
  flush: () => Promise<boolean>
  cancel: () => void
}

export interface AutosaveGroupDependencies {
  parts: readonly AutosavePart[]
  /** Called on every failed save; `retry` saves the waiting changes again */
  reportError: (message: string, retry: () => void) => void
}

/** The autosaved parts of a page, shown, saved and forgotten together */
export function createAutosaveGroup(deps: AutosaveGroupDependencies) {
  const status = computed<AutosaveSummary>(() =>
    summarizeAutosave(deps.parts.map((part) => part.status.value))
  )

  /** Saves the waiting changes now, e.g. when the page is left */
  const flush = async (): Promise<boolean> => {
    const saved = await Promise.all(deps.parts.map((part) => part.flush()))
    return saved.every(Boolean)
  }

  /** Forgets the waiting changes, e.g. of an item about to be removed */
  const cancel = () => {
    for (const part of deps.parts) part.cancel()
  }

  const retry = () => void flush()
  for (const part of deps.parts) {
    // every failure is told, even one with the same message as the last
    watch(
      part.status,
      (next) => {
        if (next === 'error') deps.reportError(part.error.value, retry)
      },
      { flush: 'sync' }
    )
  }

  return { status, flush, cancel }
}
