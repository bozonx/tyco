import { describe, expect, it } from 'vitest'
import { createContributionRegistry } from './contribution-registry'

describe('contribution registry', () => {
  it('orders async registrations by order and owner while preserving local order', () => {
    const registry = createContributionRegistry<{
      id: string
      ownerPluginId: string
      order?: number
    }>()
    registry.register([{ id: 'b', ownerPluginId: 'Beta' }])
    registry.register([
      { id: 'a1', ownerPluginId: 'Alpha' },
      { id: 'a2', ownerPluginId: 'Alpha' },
    ])
    registry.register([{ id: 'first', ownerPluginId: 'Beta', order: -1 }])
    expect(registry.list().map((item) => item.id)).toEqual([
      'first',
      'a1',
      'a2',
      'b',
    ])
  })
  it('removes explicit owners without interpreting IDs', () => {
    const registry = createContributionRegistry<{
      id: string
      ownerPluginId?: string
    }>()
    registry.register([
      { id: 'unrelated', ownerPluginId: 'Alpha' },
      { id: 'Alpha:other', ownerPluginId: 'Beta' },
      { id: 'Alpha:core' },
    ])
    registry.unregisterPlugin('Alpha')
    expect(registry.list().map((item) => item.id)).toEqual([
      'Alpha:core',
      'Alpha:other',
    ])
  })
  it('disposes only its own registration and preserves replacements', () => {
    const registry = createContributionRegistry<{ id: string }>()
    const dispose = registry.register([{ id: 'item' }])
    const replacement = { id: 'item' }
    registry.register([replacement])
    dispose()
    expect(registry.list()).toEqual([replacement])
  })
})
