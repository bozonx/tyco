import { errorMessage } from '@tyco/shared/value-guards'
import { isRecord as object } from '@tyco/shared/value-guards'
import { computed, ref } from 'vue'
import type { DesktopErrorCode, IpcResult, UserConfig } from '@tyco/shared'

import { backoffDelayMs } from '../timers/backoff'

/** A failed save is retried a few times, waiting longer each time */
const MAX_SAVE_RETRIES = 3
const FIRST_SAVE_RETRY_MS = 1000
/** Failures that may pass by themselves; the others need the user */
const RETRYABLE_SAVE_ERRORS: readonly DesktopErrorCode[] = [
  'ioError',
  'serviceUnavailable',
  'busy',
]

export interface SettingsSessionDependencies {
  initialConfig: UserConfig
  prepare: (config: unknown) => UserConfig
  save: (next: UserConfig, base: UserConfig) => Promise<IpcResult<UserConfig>>
  canSave: () => boolean
  /** Told once per distinct failure; repeated attempts stay quiet */
  notifyError: (message: string) => void
  /** Told when edits from another window start blocking the autosave */
  notifyConflict?: () => void
  debounceMs: number
  getLatestConfig?: () => UserConfig
  loadConfig?: () => Promise<UserConfig>
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b)

function asEntities(
  value: unknown
): Map<string, Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null
  const map = new Map<string, Record<string, unknown>>()
  for (const item of value) {
    if (!object(item) || typeof item.id !== 'string' || map.has(item.id)) {
      return null
    }
    map.set(item.id, item as Record<string, unknown>)
  }
  return map
}

/**
 * Reapplies local edits (`submitted` → `draft`) over a newer config `saved`;
 * entity collections merge by id. A field changed on both sides keeps the local
 * value, or the saved one with `preferSaved`
 */
function rebase(
  saved: unknown,
  submitted: unknown,
  draft: unknown,
  preferSaved = false
): unknown {
  if (equal(submitted, draft)) return saved
  if (equal(submitted, saved)) return draft
  const savedEntities = asEntities(saved)
  const submittedEntities = asEntities(submitted)
  const draftEntities = asEntities(draft)
  if (savedEntities && submittedEntities && draftEntities) {
    const draftArray = draft as Record<string, unknown>[]
    const savedArray = saved as Record<string, unknown>[]
    const draftIds = new Set(draftArray.map((item) => String(item.id)))
    const merged = draftArray.flatMap((item) => {
      const id = String(item.id)
      const savedItem = savedEntities.get(id)
      const submittedItem = submittedEntities.get(id)
      if (savedItem && submittedItem) {
        return [rebase(savedItem, submittedItem, item, preferSaved)]
      }
      // removed elsewhere: gone unless edited here (and kept on a conflict)
      if (submittedItem && (preferSaved || equal(submittedItem, item))) {
        return []
      }
      return [item]
    })
    for (const savedItem of savedArray) {
      const id = String(savedItem.id)
      if (draftIds.has(id)) continue
      const submittedItem = submittedEntities.get(id)
      // added elsewhere, or removed here while changed elsewhere
      if (!submittedItem || (preferSaved && !equal(submittedItem, savedItem))) {
        merged.push(savedItem)
      }
    }
    return merged
  }
  if (!object(saved) || !object(submitted) || !object(draft)) {
    return preferSaved ? saved : draft
  }
  const result = { ...saved }
  for (const key of new Set([
    ...Object.keys(submitted),
    ...Object.keys(draft),
  ])) {
    if (equal(submitted[key], draft[key])) continue
    if (!Object.hasOwn(draft, key)) {
      if (!preferSaved || equal(submitted[key], saved[key])) delete result[key]
    } else {
      result[key] = rebase(saved[key], submitted[key], draft[key], preferSaved)
    }
  }
  return result
}

function findConflicts(
  current: unknown,
  base: unknown,
  next: unknown,
  path = ''
): string[] {
  if (equal(base, next) || equal(current, base) || equal(current, next))
    return []
  const currentEntities = asEntities(current)
  const baseEntities = asEntities(base)
  const nextEntities = asEntities(next)
  if (currentEntities && baseEntities && nextEntities) {
    const allIds = new Set([
      ...currentEntities.keys(),
      ...baseEntities.keys(),
      ...nextEntities.keys(),
    ])
    const conflicts: string[] = []
    for (const id of allIds) {
      const cur = currentEntities.get(id)
      const b = baseEntities.get(id)
      const n = nextEntities.get(id)
      const itemPath = path ? `${path}[${id}]` : `[${id}]`
      if (cur && b && n) {
        conflicts.push(...findConflicts(cur, b, n, itemPath))
      } else if (!equal(cur, b) && !equal(n, b) && !equal(cur, n)) {
        conflicts.push(itemPath)
      }
    }
    return conflicts
  }
  if (!object(current) || !object(base) || !object(next)) return [path]
  return [
    ...new Set([
      ...Object.keys(current),
      ...Object.keys(base),
      ...Object.keys(next),
    ]),
  ].flatMap((key) =>
    findConflicts(
      current[key],
      base[key],
      next[key],
      path ? `${path}.${key}` : key
    )
  )
}

export function createSettingsSession(deps: SettingsSessionDependencies) {
  let baseline = clone(deps.initialConfig)
  let savedDraft = deps.prepare(baseline)
  const draft = ref<UserConfig>(clone(savedDraft))
  const latestConfig = ref<UserConfig>(clone(baseline))
  // the prepared latest config and whether it differs from what was edited
  // from: most edits are checked for conflicts without walking the config
  let preparedLatest = savedDraft
  let hasRemoteChanges = false
  const isSaving = ref(false)
  const saveError = ref('')
  const conflicts = ref<string[]>([])
  const reloadCount = ref(0)
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined
  let retryCount = 0
  let isApplying = false
  const prepareDraft = () => deps.prepare(draft.value)
  const isSaved = (prepared = prepareDraft()) => equal(prepared, savedDraft)
  const hasUnsavedChanges = computed(() => !isSaved())
  const setLatest = (config: UserConfig) => {
    latestConfig.value = clone(config)
    preparedLatest = deps.prepare(config)
    hasRemoteChanges = !equal(preparedLatest, savedDraft)
  }
  const setBaseline = (config: UserConfig) => {
    baseline = clone(config)
    savedDraft = deps.prepare(baseline)
    setLatest(config)
  }
  const setConflicts = (next: string[]) => {
    const hadConflicts = conflicts.value.length > 0
    conflicts.value = next
    if (!hadConflicts && next.length) deps.notifyConflict?.()
  }
  const refreshConflicts = (prepared = prepareDraft()) => {
    setConflicts(
      hasRemoteChanges
        ? findConflicts(preparedLatest, savedDraft, prepared)
        : []
    )
  }
  /**
   * What is sent: the local edits applied to the stored config, so that what
   * only the webview fills in, e.g. plugin defaults, is not written unchanged
   */
  const toPayload = (prepared: UserConfig) =>
    clone(rebase(baseline, savedDraft, prepared)) as UserConfig
  const applyIncoming = (incoming: UserConfig) => {
    if (isSaving.value || !isSaved()) {
      setLatest(incoming)
      refreshConflicts()
      return
    }
    setBaseline(incoming)
    draft.value = clone(savedDraft)
    conflicts.value = []
  }
  const reportFailure = (message: string, code?: DesktopErrorCode) => {
    // the same failure again, e.g. on the next keystroke, is shown already
    if (saveError.value !== message) deps.notifyError(message)
    saveError.value = message
    if (
      active &&
      retryCount < MAX_SAVE_RETRIES &&
      !conflicts.value.length &&
      (!code || RETRYABLE_SAVE_ERRORS.includes(code))
    ) {
      timer = setTimeout(
        () => {
          timer = undefined
          void persist()
        },
        backoffDelayMs(retryCount++, { firstMs: FIRST_SAVE_RETRY_MS })
      )
    }
  }
  const canPersist = () => {
    if (!deps.canSave()) return false
    const prepared = prepareDraft()
    if (isSaved(prepared)) return false
    refreshConflicts(prepared)
    return !conflicts.value.length
  }
  const persist = (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    if (pending) return pending
    if (!canPersist()) return Promise.resolve()
    isSaving.value = true
    // Read the draft at execution time and drain edits made during the write.
    // There is never a queue of obsolete snapshots with destructive policies.
    pending = Promise.resolve().then(async () => {
      try {
        while (canPersist()) {
          const submitted = clone(prepareDraft())
          const result = await deps.save(toPayload(submitted), clone(baseline))
          if (!result.success) {
            if (result.errorCode === 'configConflict' && deps.loadConfig) {
              try {
                applyIncoming(await deps.loadConfig())
              } catch {
                /* Keep the dirty draft for manual recovery. */
              }
            }
            reportFailure(result.error, result.errorCode)
            break
          }
          const saved = deps.getLatestConfig?.() ?? result.result
          const rawDraft = clone(draft.value)
          setBaseline(saved)
          isApplying = true
          // Preserve unfinished UI values while adopting backend updates.
          // A copy: the rebase shares objects with `savedDraft`, and an edit
          // of the draft would change it too, so the edit would look saved.
          draft.value = clone(
            rebase(savedDraft, submitted, rawDraft)
          ) as UserConfig
          isApplying = false
          saveError.value = ''
          conflicts.value = []
          retryCount = 0
        }
      } catch (error) {
        reportFailure(errorMessage(error))
      } finally {
        isSaving.value = false
        pending = undefined
      }
    })
    return pending
  }
  const schedule = () => {
    if (isApplying) return
    clearTimeout(timer)
    timer = undefined
    const prepared = prepareDraft()
    refreshConflicts(prepared)
    if (!isSaving.value && isSaved(prepared)) {
      saveError.value = ''
      retryCount = 0
      if (hasRemoteChanges) {
        isApplying = true
        applyIncoming(latestConfig.value)
        isApplying = false
      }
      return
    }
    if (!active || conflicts.value.length || isSaving.value || !deps.canSave())
      return
    retryCount = 0
    timer = setTimeout(() => {
      timer = undefined
      void persist()
    }, deps.debounceMs)
  }
  const adopt = (incoming: UserConfig, next: unknown) => {
    setBaseline(incoming)
    draft.value = clone(next as UserConfig)
    conflicts.value = []
    saveError.value = ''
    retryCount = 0
  }
  /**
   * Settles the fields changed in both windows: `mine` keeps the local values,
   * `theirs` takes the other window's. Every other local edit stays either way
   */
  const resolveConflicts = (keep: 'mine' | 'theirs') => {
    if (isSaving.value) return
    const incoming = deps.getLatestConfig?.() ?? latestConfig.value
    adopt(
      incoming,
      rebase(deps.prepare(incoming), savedDraft, draft.value, keep === 'theirs')
    )
  }
  /** Drops every local edit and shows the stored settings */
  const reload = async () => {
    if (isSaving.value) return
    if (deps.loadConfig) setLatest(await deps.loadConfig())
    const incoming = deps.getLatestConfig?.() ?? latestConfig.value
    adopt(incoming, deps.prepare(incoming))
    reloadCount.value++
  }
  const dispose = () => {
    active = false
    clearTimeout(timer)
    return persist()
  }
  return {
    draft,
    latestConfig,
    isSaving,
    saveError,
    conflicts,
    hasUnsavedChanges,
    reloadCount,
    applyIncoming,
    persist,
    schedule,
    resolveConflicts,
    reload,
    dispose,
    isSaved: () => isSaved(),
  }
}
