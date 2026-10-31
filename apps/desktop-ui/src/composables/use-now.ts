import { onScopeDispose, ref, type Ref } from 'vue'

/** How often the time is read again; enough for day groups */
const DEFAULT_INTERVAL_MS = 60_000

/**
 * The current time, read again every `intervalMs`, so that what depends on the
 * day (today, yesterday) changes after midnight
 */
export function useNow(intervalMs = DEFAULT_INTERVAL_MS): Ref<number> {
  const now = ref(Date.now())
  const timer = setInterval(() => {
    now.value = Date.now()
  }, intervalMs)
  onScopeDispose(() => clearInterval(timer))
  return now
}
