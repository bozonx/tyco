import type { ToolbarItem } from '../../types/plugins'
import { createContributionRegistry } from '../plugins/contribution-registry'

export function createToolbarModel() {
  const registry = createContributionRegistry<ToolbarItem>()
  return {
    registeredToolbarItems: registry.items,
    unregisterPlugin: registry.unregisterPlugin,
    getToolbarItems: registry.list,
    getLeftToolbarItems: () =>
      registry.list().filter((item) => item.position === 'left'),
    getRightToolbarItems: () =>
      registry.list().filter((item) => item.position !== 'left'),
    registerToolbarItems: registry.register,
  }
}
