import {
  onBeforeUnmount,
  onMounted,
  toValue,
  watch,
  type WatchSource,
} from 'vue'

/**
 * Short feedback on a rendered state change, without delaying input or
 * teardown.
 */
export function useFeedbackMotion<T>(
  getElement: () => HTMLElement | null | undefined,
  source: WatchSource<T>,
  options: {
    direction?: (next: T, previous: T) => number
    distancePx?: number
    durationMs?: number
    appear?: boolean
  } = {}
) {
  let animation: Animation | undefined
  const cancel = () => {
    animation?.cancel()
    animation = undefined
  }
  const play = (next: T, previous: T) => {
    cancel()
    const element = getElement()
    if (!element?.animate || element.closest('[data-theme="eInk"]')) return
    const reduced =
      document.documentElement.dataset.motion === 'reduce' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const direction = options.direction?.(next, previous) ?? 1
    const distance = reduced ? 0 : (options.distancePx ?? 4) * direction
    animation = element.animate(
      [
        { opacity: 0.55, transform: `translateX(${distance}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      {
        duration: reduced ? 60 : (options.durationMs ?? 150),
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      }
    )
  }
  watch(source, play, { flush: 'post' })
  if (options.appear)
    onMounted(() => {
      const value = toValue(source)
      play(value, value)
    })
  onBeforeUnmount(cancel)
}
