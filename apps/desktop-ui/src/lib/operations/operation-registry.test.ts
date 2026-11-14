import { describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

import {
  createOperationRegistry,
  pluginOperationId,
} from './operation-registry'
import { TEXT_INPUT_SCHEMA, type OperationDefinition } from './operation-types'

const tool = (id: string): OperationDefinition => ({
  id,
  description: id,
  inputSchema: TEXT_INPUT_SCHEMA,
  run: vi.fn(async () => ({ ok: true })),
})

describe('createOperationRegistry', () => {
  it('keeps the core tools under their own ids', () => {
    const registry = createOperationRegistry([tool('script')])
    expect(registry.get('script')).toMatchObject({
      id: 'script',
      owner: { kind: 'core' },
    })
    registry.registerCoreOperations([tool('core.copy')])
    expect(registry.list().map((item) => item.id)).toEqual([
      'script',
      'core.copy',
    ])
  })

  it('puts plugin tools under the plugin name with its settings', () => {
    const registry = createOperationRegistry()
    const settings = vi.fn(() => ({ url: 'https://x.test' }))
    registry.registerPluginOperations('Search', [tool('search')], settings)
    const registered = registry.get('Search.search')
    expect(pluginOperationId('Search', 'search')).toBe('Search.search')
    expect(registered).toMatchObject({
      id: 'Search.search',
      owner: { kind: 'plugin', pluginId: 'Search' },
    })
    expect(registered?.baseConfig?.()).toEqual({ url: 'https://x.test' })
    expect(registry.get('search')).toBeUndefined()
  })

  it('drops the plugin tools and keeps the core ones', () => {
    const registry = createOperationRegistry([tool('script')])
    registry.registerPluginOperations('Notes', [tool('write')])
    registry.unregisterPlugin('Notes')
    expect(registry.list().map((item) => item.id)).toEqual(['script'])
  })

  it('lets computed values follow the registered tools', () => {
    const registry = createOperationRegistry()
    const known = computed(() => Boolean(registry.get('Notes.write')))
    expect(known.value).toBe(false)
    registry.registerPluginOperations('Notes', [tool('write')])
    expect(known.value).toBe(true)
    registry.unregisterPlugin('Notes')
    expect(known.value).toBe(false)
  })
})

it('keeps plugin tools ordered independently of activation timing and protects replacements from stale disposal', () => {
  const registry = createOperationRegistry([tool('core.copy')])
  const dispose = registry.registerPluginOperations('Zulu', [tool('write')])
  registry.registerPluginOperations('Alpha', [tool('search')])
  expect(registry.list().map((item) => item.id)).toEqual([
    'core.copy',
    'Alpha.search',
    'Zulu.write',
  ])
  registry.unregisterPlugin('Zulu')
  registry.registerPluginOperations('Zulu', [tool('write')])
  dispose()
  expect(registry.get('Zulu.write')).toBeDefined()
})
