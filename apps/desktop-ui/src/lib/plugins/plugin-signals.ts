/** Link lifetimes without requiring AbortSignal.any in older desktop webviews. */
export function linkPluginSignals(signals: readonly AbortSignal[]) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  for (const signal of signals) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of signals) signal.removeEventListener('abort', abort)
    },
  }
}
