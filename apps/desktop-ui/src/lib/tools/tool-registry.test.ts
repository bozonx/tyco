import { describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

import { createToolRegistry, pluginToolId } from './tool-registry'
import { TEXT_INPUT_SCHEMA, type ToolDefinition } from './tool-types'

const tool = (id: string): ToolDefinition => ({
  id,
  description: id,
  inputSchema: TEXT_INPUT_SCHEMA,
  run: vi.fn(async () => ({ ok: true })),
})

describe('createToolRegistry', () => {
  it('keeps the core tools under their own ids', () => {
    const registry = createToolRegistry([tool('script')])
    expect(registry.get('script')).toMatchObject({
      id: 'script',
      owner: { kind: 'core' },
    })
    registry.registerCoreTools([tool('core.copy')])
    expect(registry.list().map((item) => item.id)).toEqual([
      'script',
      'core.copy',
    ])
  })

  it('puts plugin tools under the plugin name with its settings', () => {
    const registry = createToolRegistry()
    const settings = vi.fn(() => ({ url: 'https://x.test' }))
    registry.registerPluginTools('Search', [tool('search')], settings)
    const registered = registry.get('Search.search')
    expect(pluginToolId('Search', 'search')).toBe('Search.search')
    expect(registered).toMatchObject({
      id: 'Search.search',
      owner: { kind: 'plugin', name: 'Search' },
    })
    expect(registered?.baseConfig?.()).toEqual({ url: 'https://x.test' })
    expect(registry.get('search')).toBeUndefined()
  })

  it('drops the plugin tools and keeps the core ones', () => {
    const registry = createToolRegistry([tool('script')])
    registry.registerPluginTools('Notes', [tool('write')])
    registry.clearPluginTools()
    expect(registry.list().map((item) => item.id)).toEqual(['script'])
  })

  it('lets computed values follow the registered tools', () => {
    const registry = createToolRegistry()
    const known = computed(() => Boolean(registry.get('Notes.write')))
    expect(known.value).toBe(false)
    registry.registerPluginTools('Notes', [tool('write')])
    expect(known.value).toBe(true)
    registry.clearPluginTools()
    expect(known.value).toBe(false)
  })
})
