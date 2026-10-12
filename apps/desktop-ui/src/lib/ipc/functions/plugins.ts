import type { PluginPackagePreview } from '@tyco/shared'

export interface PluginsFunctions {
  inspectPluginPackage: { args: [] }
  listInstalledPlugins: { args: [] }
  installPluginPackage: { args: [preview: PluginPackagePreview] }
  restorePluginPackage: { args: [id: string] }
  removePluginPackage: { args: [id: string] }
}
