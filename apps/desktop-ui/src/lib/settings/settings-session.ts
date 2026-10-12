import { ref } from 'vue'
import type { IpcResult, UserConfig } from '@tyco/shared'

export interface SettingsSessionDeps {
  initialConfig: UserConfig
  prepare: (config: unknown) => UserConfig
  save: (next: UserConfig, base: UserConfig) => Promise<IpcResult<UserConfig>>
  canSave: () => boolean
  notifyError: (message: string) => void
  debounceMs: number
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b)
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Reapplies edits made during a save over the backend's merged result. */
function rebase(saved: unknown, submitted: unknown, draft: unknown): unknown {
  if (equal(submitted, draft)) return saved
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

export function createSettingsSession(deps: SettingsSessionDeps) {
  let baseline = clone(deps.initialConfig)
  let savedDraft = deps.prepare(baseline)
  const draft = ref<UserConfig>(clone(savedDraft))
  let active = true
  let pending = 0
  let lastQueued: UserConfig | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()
  const isSaved = () => equal(deps.prepare(draft.value), savedDraft)
  const applyIncoming = (incoming: UserConfig) => {
    // Keep the baseline of unsaved edits so the backend can detect conflicts.
    if (pending || !isSaved()) return
    baseline = clone(incoming)
    savedDraft = deps.prepare(baseline)
    draft.value = clone(savedDraft)
  }
  const persist = (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    if (!deps.canSave() || isSaved()) return queue
    const submitted = clone(deps.prepare(draft.value))
    if (pending && equal(submitted, lastQueued)) return queue
    lastQueued = submitted
    const base = clone(baseline)
    pending++
    queue = queue.then(async () => {
      try {
        const rebased = deps.prepare(rebase(baseline, base, submitted))
        const result = await deps.save(rebased, clone(baseline))
        if (!result.success) {
          deps.notifyError(result.error ?? 'Settings save failed')
          return
        }
        const saved = result.result ?? submitted
        const currentDraft = deps.prepare(draft.value)
        baseline = clone(saved)
        savedDraft = deps.prepare(saved)
        draft.value = deps.prepare(rebase(saved, submitted, currentDraft))
      } catch (error) {
        deps.notifyError(error instanceof Error ? error.message : String(error))
      } finally {
        pending--
      }
    })
    return queue
  }
  const schedule = () => {
    clearTimeout(timer)
    if (!active || isSaved()) return
    timer = setTimeout(() => {
      timer = undefined
      void persist()
    }, deps.debounceMs)
  }
  const dispose = () => {
    active = false
    const pendingSave = persist()
    clearTimeout(timer)
    return pendingSave
  }
  return { draft, applyIncoming, persist, schedule, dispose, isSaved }
}
