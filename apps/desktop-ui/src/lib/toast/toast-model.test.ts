import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_TOAST_DURATIONS_MS,
  MAX_TOASTS_COUNT,
  createToastModel,
} from './toast-model'

describe('createToastModel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds a toast with default durations', () => {
    const store = createToastModel()
    const id = store.addToast('Operation succeeded', 'success')

    expect(store.toasts.value).toHaveLength(1)
    expect(store.toasts.value[0]).toMatchObject({
      id,
      message: 'Operation succeeded',
      type: 'success',
      durationMs: DEFAULT_TOAST_DURATIONS_MS.success,
    })
  })

  it('supports custom durationMs and title', () => {
    const store = createToastModel()
    const id = store.addToast('Custom message', 'error', {
      title: 'Failed',
      durationMs: 3000,
    })

    expect(store.toasts.value[0]).toMatchObject({
      id,
      title: 'Failed',
      message: 'Custom message',
      type: 'error',
      durationMs: 3000,
    })
  })

  it('auto-dismisses toast after its durationMs', () => {
    const store = createToastModel()
    store.addToast('Expiring toast', 'info', { durationMs: 2000 })

    expect(store.toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(1999)
    expect(store.toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(store.toasts.value).toHaveLength(0)
  })

  it('removes toast explicitly by id', () => {
    const store = createToastModel()
    const id = store.addToast('Item to remove', 'warn')

    expect(store.toasts.value).toHaveLength(1)
    store.removeToast(id)
    expect(store.toasts.value).toHaveLength(0)
  })

  it('pauses and resumes countdown on hover', () => {
    let currentTime = 1000
    const now = () => currentTime
    const store = createToastModel({ now })

    const id = store.addToast('Hover toast', 'info', { durationMs: 4000 })

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

  it('pauses and resumes multiple times without losing remaining time', () => {
    let currentTime = 1000
    const now = () => currentTime
    const store = createToastModel({ now })

    const id = store.addToast('Multi hover toast', 'info', { durationMs: 4000 })

    // Pass 1000ms
    currentTime += 1000
    vi.advanceTimersByTime(1000)

    // Pause 1
    store.pauseToast(id)
    expect(store.toasts.value[0]?.remainingMs).toBe(3000)

    // Hover for 3000ms
    currentTime += 3000
    vi.advanceTimersByTime(3000)

    // Resume 1
    store.resumeToast(id)

    // Pass 1000ms
    currentTime += 1000
    vi.advanceTimersByTime(1000)

    // Pause 2
    store.pauseToast(id)
    expect(store.toasts.value[0]?.remainingMs).toBe(2000)

    // Hover for 2000ms
    currentTime += 2000
    vi.advanceTimersByTime(2000)

    // Resume 2
    store.resumeToast(id)

    // Advance remaining 1999ms
    currentTime += 1999
    vi.advanceTimersByTime(1999)
    expect(store.toasts.value).toHaveLength(1)

    currentTime += 1
    vi.advanceTimersByTime(1)
    expect(store.toasts.value).toHaveLength(0)
  })

  it('deduplicates identical toasts by refreshing durationMs', () => {
    const store = createToastModel()
    const id1 = store.addToast('Duplicate message', 'warn', {
      durationMs: 3000,
    })

    vi.advanceTimersByTime(1500)
    expect(store.toasts.value).toHaveLength(1)

    // Add duplicate message
    const id2 = store.addToast('Duplicate message', 'warn', {
      durationMs: 3000,
    })
    expect(id2).toBe(id1)
    expect(store.toasts.value).toHaveLength(1)
    expect(store.toasts.value[0]?.remainingMs).toBe(3000)

    // Should stay alive for full new durationMs (1500 + 2999 = 4499ms total from start)
    vi.advanceTimersByTime(2999)
    expect(store.toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(store.toasts.value).toHaveLength(0)
  })

  it('respects MAX_TOASTS_COUNT limit by evicting oldest toasts', () => {
    const store = createToastModel()

    for (let i = 1; i <= MAX_TOASTS_COUNT + 2; i++) {
      store.addToast(`Toast ${i}`, 'info', { durationMs: 0 })
    }

    expect(store.toasts.value).toHaveLength(MAX_TOASTS_COUNT)
    expect(store.toasts.value[0]?.message).toBe('Toast 3')
    expect(store.toasts.value[MAX_TOASTS_COUNT - 1]?.message).toBe('Toast 7')
  })

  it('clears all toasts', () => {
    const store = createToastModel()
    store.addToast('Toast 1', 'info', { durationMs: 10000 })
    store.addToast('Toast 2', 'error', { durationMs: 10000 })

    expect(store.toasts.value).toHaveLength(2)
    store.clearToasts()
    expect(store.toasts.value).toHaveLength(0)
  })
})
