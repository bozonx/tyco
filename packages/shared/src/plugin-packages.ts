import type { PluginManifest } from '@tyco/plugin-sdk'

export interface InstalledPluginPackage {
  manifest: PluginManifest
  modulePath: string
}
export interface PluginPackagePreview {
  path: string
  manifest: PluginManifest
}
