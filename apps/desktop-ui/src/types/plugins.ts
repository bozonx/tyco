import type { PluginDefinition } from '@tyco/plugin-sdk'
export * from '@tyco/plugin-sdk'

export type PluginIndex = () => PluginDefinition & {
  name: string
  _revision?: string
  _loadError?: string
  _incompatible?: boolean
  _external?: boolean
  _canRestore?: boolean
}
