import { ref, type Ref } from 'vue'

export type ToastType = 'success' | 'error' | 'warn' | 'info'

export interface ToastOptions {
  title?: string
  duration?: number
}

export interface ToastItem {
  id: string
  message: string
  title?: string
  type: ToastType
  duration: number
  createdAt: number
  remainingMs: number
  isPaused: boolean
  timerId?: ReturnType<typeof setTimeout> | null
  pauseStartedAt?: number | null
}

export interface ToastDependencies {
  now?: () => number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

export const DEFAULT_TOAST_DURATIONS: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warn: 6000,
  error: 8000,
}

export const MAX_TOASTS = 5

export function createToastStoreModel(deps: ToastDependencies = {}) {
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

    item.timerId = setTimeoutFn(() => {
      removeToast(item.id)
    }, item.remainingMs)
  }

  const addToast = (
    message: string,
    type: ToastType = 'info',
    options: ToastOptions = {}
  ): string => {
    const duration = options.duration ?? DEFAULT_TOAST_DURATIONS[type]
    const id = `toast-${now()}-${++counter}`

    const item: ToastItem = {
      id,
      message,
      title: options.title,
      type,
      duration,
      createdAt: now(),
      remainingMs: duration,
      isPaused: false,
      timerId: null,
      pauseStartedAt: null,
    }

    if (duration > 0) {
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
    if (!item || item.isPaused || item.duration <= 0) return

    clearItemTimer(item)
    item.isPaused = true
    const currentNow = now()
    const elapsedSinceStart = item.pauseStartedAt
      ? 0
      : currentNow - (item.createdAt + (item.duration - item.remainingMs))
    item.remainingMs = Math.max(
      0,
      item.remainingMs - Math.max(0, elapsedSinceStart)
    )
    item.pauseStartedAt = currentNow
  }

  const resumeToast = (id: string) => {
    const item = toasts.value.find((t) => t.id === id)
    if (!item || !item.isPaused || item.duration <= 0) return

    item.isPaused = false
    item.pauseStartedAt = null
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
