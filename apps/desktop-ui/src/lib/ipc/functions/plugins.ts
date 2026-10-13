import type { PluginPackagePreview } from '@tyco/shared'

export interface PluginsFunctions {
  writePluginNote: {
    args: [
      pluginId: string,
      dir: string,
      fileName: string,
      text: string,
      append: boolean,
    ]
  }
  inspectPluginPackage: { args: [] }
  listInstalledPlugins: { args: [] }
  installPluginPackage: { args: [preview: PluginPackagePreview] }
  restorePluginPackage: { args: [id: string] }
  removePluginPackage: { args: [id: string] }
}
