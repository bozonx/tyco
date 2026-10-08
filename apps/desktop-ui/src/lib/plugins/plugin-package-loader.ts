import {
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type PluginManifest,
} from '@tyco/plugin-sdk'
import type { InstalledPluginPackage } from '@tyco/shared'

import type { PluginIndex } from '../../types/plugins'

export interface PluginPackageLoaderDependencies {
  activate(
    manifest: PluginManifest,
    modulePath: string,
    ctx: Parameters<ReturnType<PluginIndex>['init']>[0]
  ): Promise<void>
  reportError(id: string, error: unknown): void
}
/** Builds a catalog from declarative metadata without importing any plugin code. */
export function createPluginPackageLoader(
  deps: PluginPackageLoaderDependencies
) {
  async function load(
    packages: InstalledPluginPackage[],
    reservedIds: readonly string[]
  ): Promise<PluginIndex[]> {
    const factories: PluginIndex[] = []
    const seen = new Set(reservedIds)
    for (const installed of packages) {
      const { manifest, modulePath } = installed
      try {
        if (seen.has(manifest.id))
          throw new Error(`Duplicate plugin ID: ${manifest.id}`)
        seen.add(manifest.id)
        validatePluginManifest(manifest)
        if (!/^[a-f0-9]+\/[0-9]+\.js$/.test(modulePath))
          throw new Error('Invalid plugin module path')
        factories.push(() => ({
          ...manifest,
          name: manifest.id,
          _revision: modulePath,
          _external: true,
          _canRestore: installed.canRestore,
          init: (ctx) => deps.activate(manifest, modulePath, ctx),
        }))
      } catch (error) {
        deps.reportError(manifest.id, error)
        if (
          !reservedIds.includes(manifest.id) &&
          /^[A-Za-z0-9][A-Za-z0-9 _-]{0,127}$/.test(manifest.id)
        ) {
          const message = error instanceof Error ? error.message : String(error)
          factories.push(() => ({
            id: manifest.id,
            version: '0.0.0',
            apiVersion: PLUGIN_API_VERSION,
            capabilities: [],
            defaultLocale: 'en_US',
            locales: { en_US: {} },
            name: manifest.id,
            _revision: modulePath,
            _external: true,
            _canRestore: installed.canRestore,
            _incompatible: manifest.apiVersion !== PLUGIN_API_VERSION,
            _loadError: message,
            init: () => {},
          }))
        }
      }
    }
    return factories
  }
  return { load }
}
