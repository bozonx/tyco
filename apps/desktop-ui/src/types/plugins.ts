import type { PluginDefinition } from '@tyco/plugin-sdk'
export * from '@tyco/plugin-sdk'
/** Compatibility for bundled definitions predating the package manifest. */
export type PluginIndex = () => Pick<PluginDefinition, 'init'> &
  Partial<PluginDefinition> & {
    name: string
    _revision?: string
    _loadError?: string
  }
