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
  'runtimeError',
  'operationFailed',
]

export interface SettingsSessionDependencies {
  initialConfig: UserConfig
  prepare: (config: unknown) => UserConfig
  save: (next: UserConfig, base: UserConfig) => Promise<IpcResult<UserConfig>>
  canSave: () => boolean
  notifyError: (message: string) => void
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

/** Reapplies local edits over a newer config; entity collections merge by id. */
function rebase(saved: unknown, submitted: unknown, draft: unknown): unknown {
  if (equal(submitted, draft)) return saved
  const savedEntities = asEntities(saved)
  const submittedEntities = asEntities(submitted)
  const draftEntities = asEntities(draft)
  if (savedEntities && submittedEntities && draftEntities) {
    const draftArray = draft as Record<string, unknown>[]
    const savedArray = saved as Record<string, unknown>[]
    const draftIds = new Set(draftArray.map((item) => String(item.id)))
    const merged = draftArray.map((item) => {
      const id = String(item.id)
      const savedItem = savedEntities.get(id)
      const submittedItem = submittedEntities.get(id)
      if (savedItem && submittedItem) {
        return rebase(savedItem, submittedItem, item)
      }
      return item
    })
    for (const savedItem of savedArray) {
      const id = String(savedItem.id)
      if (!draftIds.has(id) && !submittedEntities.has(id)) {
        merged.push(savedItem)
      }
    }
    return merged
  }
  if (!object(saved) || !object(submitted) || !object(draft)) return draft
  const result = { ...saved }
  for (const key of new Set([
    ...Object.keys(submitted),
    ...Object.keys(draft),
  ])) {
    if (equal(submitted[key], draft[key])) continue
    if (!Object.hasOwn(draft, key)) delete result[key]
    else result[key] = rebase(saved[key], submitted[key], draft[key])
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
  const isSaving = ref(false)
  const saveError = ref('')
  const conflicts = ref<string[]>([])
  const reloadCount = ref(0)
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined
  let retryCount = 0
  let isApplying = false
  const isSaved = () => equal(deps.prepare(draft.value), savedDraft)
  const hasUnsavedChanges = computed(() => !isSaved())
  const refreshConflicts = () => {
    conflicts.value = findConflicts(
      deps.prepare(latestConfig.value),
      savedDraft,
      deps.prepare(draft.value)
    )
  }
  const applyIncoming = (incoming: UserConfig) => {
    latestConfig.value = clone(incoming)
    if (isSaving.value || !isSaved()) {
      refreshConflicts()
      return
    }
    baseline = clone(incoming)
    savedDraft = deps.prepare(baseline)
    draft.value = clone(savedDraft)
    conflicts.value = []
  }
  const reportFailure = (message: string, code?: DesktopErrorCode) => {
    saveError.value = message
    deps.notifyError(message)
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
  const persist = (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    if (pending) return pending
    if (!deps.canSave() || isSaved() || conflicts.value.length)
      return Promise.resolve()
    isSaving.value = true
    // Read the draft at execution time and drain edits made during the write.
    // There is never a queue of obsolete snapshots with destructive policies.
    pending = Promise.resolve().then(async () => {
      try {
        while (deps.canSave() && !isSaved() && !conflicts.value.length) {
          const submitted = clone(deps.prepare(draft.value))
          const result = await deps.save(submitted, clone(baseline))
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
          baseline = clone(saved)
          latestConfig.value = clone(saved)
          savedDraft = deps.prepare(saved)
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
    refreshConflicts()
    if (!isSaving.value && isSaved()) {
      saveError.value = ''
      retryCount = 0
      if (!equal(deps.prepare(latestConfig.value), savedDraft)) {
        isApplying = true
        applyIncoming(latestConfig.value)
        isApplying = false
      }
      return
    }
    if (
      !active ||
      isSaved() ||
      conflicts.value.length ||
      isSaving.value ||
      !deps.canSave()
    )
      return
    retryCount = 0
    timer = setTimeout(() => {
      timer = undefined
      void persist()
    }, deps.debounceMs)
  }
  const resolveConflicts = (keepLocalEdits: boolean) => {
    if (isSaving.value) return
    const incoming = deps.getLatestConfig?.() ?? latestConfig.value
    const next = keepLocalEdits
      ? rebase(deps.prepare(incoming), savedDraft, draft.value)
      : deps.prepare(incoming)
    baseline = clone(incoming)
    latestConfig.value = clone(incoming)
    savedDraft = deps.prepare(incoming)
    draft.value = clone(next as UserConfig)
    conflicts.value = []
    saveError.value = ''
    retryCount = 0
    if (!keepLocalEdits) reloadCount.value++
  }
  const reload = async () => {
    if (isSaving.value) return
    if (deps.loadConfig) applyIncoming(await deps.loadConfig())
    resolveConflicts(false)
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
    isSaved,
  }
}
