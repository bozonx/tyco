import { ref, type Ref } from 'vue'

export type ToastType = 'success' | 'error' | 'warn' | 'info'

export interface ToastOptions {
  title?: string
  durationMs?: number
}

export interface ToastItem {
  id: string
  message: string
  title?: string
  type: ToastType
  durationMs: number
  createdAt: number
  remainingMs: number
  isPaused: boolean
  timerId?: ReturnType<typeof setTimeout> | null
  timerStartedAt?: number | null
}

export interface ToastDependencies {
  now?: () => number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

export const DEFAULT_TOAST_DURATIONS_MS: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  warn: 5000,
  error: 7000,
}

export const MAX_TOASTS = 5

export function createToastModel(deps: ToastDependencies = {}) {
  const now = deps.now ?? Date.now
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout

  const toasts: Ref<ToastItem[]> = ref([])
  let counter = 0

  const clearItemTimer = (item: ToastItem) => {
    if (item.timerId) {
      clearTimeoutFn(item.timerId)
      item.timerId = null
    }
    item.timerStartedAt = null
  }

  const removeToast = (id: string) => {
    const index = toasts.value.findIndex((t) => t.id === id)
    if (index !== -1) {
      clearItemTimer(toasts.value[index])
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }
  }

  const scheduleDismiss = (item: ToastItem) => {
    clearItemTimer(item)
    if (item.remainingMs <= 0) {
      removeToast(item.id)
      return
    }

    item.timerStartedAt = now()
    item.timerId = setTimeoutFn(() => {
      removeToast(item.id)
    }, item.remainingMs)
  }

  const addToast = (
    message: string,
    type: ToastType = 'info',
    options: ToastOptions = {}
  ): string => {
    const durationMs = options.durationMs ?? DEFAULT_TOAST_DURATIONS_MS[type]

    const existingIndex = toasts.value.findIndex(
      (t) =>
        t.message === message &&
        t.type === type &&
        (t.title ?? undefined) === (options.title ?? undefined)
    )

    if (existingIndex !== -1) {
      const existing = toasts.value[existingIndex]
      existing.durationMs = durationMs
      existing.remainingMs = durationMs
      existing.isPaused = false
      if (durationMs > 0) {
        scheduleDismiss(existing)
      } else {
        clearItemTimer(existing)
      }
      return existing.id
    }

    const id = `toast-${now()}-${++counter}`

    const item: ToastItem = {
      id,
      message,
      title: options.title,
      type,
      durationMs,
      createdAt: now(),
      remainingMs: durationMs,
      isPaused: false,
      timerId: null,
      timerStartedAt: null,
    }

    if (durationMs > 0) {
      scheduleDismiss(item)
    }

    // If max reached, drop the oldest toast
    if (toasts.value.length >= MAX_TOASTS) {
      const oldest = toasts.value[0]
      if (oldest) {
        clearItemTimer(oldest)
      }
      toasts.value = toasts.value.slice(1)
    }

    toasts.value = [...toasts.value, item]
    return id
  }

  const pauseToast = (id: string) => {
    const item = toasts.value.find((t) => t.id === id)
    if (!item || item.isPaused || item.durationMs <= 0) return

    item.isPaused = true
    if (item.timerStartedAt != null) {
      const elapsed = now() - item.timerStartedAt
      item.remainingMs = Math.max(0, item.remainingMs - Math.max(0, elapsed))
    }
    clearItemTimer(item)
  }

  const resumeToast = (id: string) => {
    const item = toasts.value.find((t) => t.id === id)
    if (!item || !item.isPaused || item.durationMs <= 0) return

    item.isPaused = false
    scheduleDismiss(item)
  }

  const clearToasts = () => {
    for (const item of toasts.value) {
      clearItemTimer(item)
    }
    toasts.value = []
  }

  return { toasts, addToast, removeToast, pauseToast, resumeToast, clearToasts }
}
