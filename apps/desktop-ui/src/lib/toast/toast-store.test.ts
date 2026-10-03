import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_TOAST_DURATIONS,
  MAX_TOASTS,
  createToastStoreModel,
} from './toast-store'

describe('createToastStoreModel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds a toast with default durations', () => {
    const store = createToastStoreModel()
    const id = store.addToast('Operation succeeded', 'success')

    expect(store.toasts.value).toHaveLength(1)
    expect(store.toasts.value[0]).toMatchObject({
      id,
      message: 'Operation succeeded',
      type: 'success',
      duration: DEFAULT_TOAST_DURATIONS.success,
    })
  })

  it('supports custom duration and title', () => {
    const store = createToastStoreModel()
    const id = store.addToast('Custom message', 'error', {
      title: 'Failed',
      duration: 3000,
    })

    expect(store.toasts.value[0]).toMatchObject({
      id,
      title: 'Failed',
      message: 'Custom message',
      type: 'error',
      duration: 3000,
    })
  })

  it('auto-dismisses toast after its duration', () => {
    const store = createToastStoreModel()
    store.addToast('Expiring toast', 'info', { duration: 2000 })

    expect(store.toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(1999)
    expect(store.toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(store.toasts.value).toHaveLength(0)
  })

  it('removes toast explicitly by id', () => {
    const store = createToastStoreModel()
    const id = store.addToast('Item to remove', 'warn')

    expect(store.toasts.value).toHaveLength(1)
    store.removeToast(id)
    expect(store.toasts.value).toHaveLength(0)
  })

  it('pauses and resumes countdown on hover', () => {
    let currentTime = 1000
    const now = () => currentTime
    const store = createToastStoreModel({ now })

    const id = store.addToast('Hover toast', 'info', { duration: 4000 })

    // Advance 1500ms
    currentTime += 1500
    vi.advanceTimersByTime(1500)

    // Pause
    store.pauseToast(id)
    const item = store.toasts.value[0]
    expect(item?.isPaused).toBe(true)
    expect(item?.remainingMs).toBe(2500)

    // Time passes while hovered
    currentTime += 5000
    vi.advanceTimersByTime(5000)
    // Should NOT be dismissed because it was paused
    expect(store.toasts.value).toHaveLength(1)

    // Resume
    store.resumeToast(id)
    expect(store.toasts.value[0]?.isPaused).toBe(false)

    // Advance remaining 2499ms
    currentTime += 2499
    vi.advanceTimersByTime(2499)
    expect(store.toasts.value).toHaveLength(1)

    // Advance 1ms
    currentTime += 1
    vi.advanceTimersByTime(1)
    expect(store.toasts.value).toHaveLength(0)
  })

  it('respects MAX_TOASTS limit by evicting oldest toasts', () => {
    const store = createToastStoreModel()

    for (let i = 1; i <= MAX_TOASTS + 2; i++) {
      store.addToast(`Toast ${i}`, 'info', { duration: 0 })
    }

    expect(store.toasts.value).toHaveLength(MAX_TOASTS)
    expect(store.toasts.value[0]?.message).toBe('Toast 3')
    expect(store.toasts.value[MAX_TOASTS - 1]?.message).toBe('Toast 7')
  })

  it('clears all toasts', () => {
    const store = createToastStoreModel()
    store.addToast('Toast 1', 'info', { duration: 10000 })
    store.addToast('Toast 2', 'error', { duration: 10000 })

    expect(store.toasts.value).toHaveLength(2)
    store.clearToasts()
    expect(store.toasts.value).toHaveLength(0)
  })
})
