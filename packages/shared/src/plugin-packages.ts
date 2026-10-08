import type { PluginManifest } from '@tyco/plugin-sdk'

export interface InstalledPluginPackage {
  manifest: PluginManifest
  modulePath: string
  canRestore: boolean
}
export interface PluginPackagePreview {
  path: string
  digest: string
  manifest: PluginManifest
}
