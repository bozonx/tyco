import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { usePluginRuntimeStore } from './plugin-runtime'

// Exercise the actual store wiring, not just the runtime factory.
describe('plugin runtime Pinia ownership', () => {
  it('does not reuse another Pinia manager or catalog', async () => {
    const first = createPinia()
    const second = createPinia()
    try {
      const a = usePluginRuntimeStore(first)
      const b = usePluginRuntimeStore(second)
      expect(a.manager).not.toBe(b.manager)
      expect(a.pluginIndexes).not.toBe(b.pluginIndexes)
      a.pluginIndexes.splice(0)
      expect(b.pluginIndexes.length).toBeGreaterThan(0)
      disposePinia(first)
      await b.reloadPlugins()
      expect(b.pluginIndexes.length).toBeGreaterThan(0)
    } finally {
      disposePinia(first)
      disposePinia(second)
    }
  })
})
