import { errorMessage } from '@tyco/shared/value-guards'
import {
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type PluginManifest,
  SUPPORTED_PLUGIN_LOCALES,
} from '@tyco/plugin-sdk'
import type { InstalledPlugin } from '@tyco/shared'

import type { PluginFactory } from '../../types/plugins'

export interface PluginPackageLoaderDependencies {
  activate(
    manifest: PluginManifest,
    modulePath: string,
    ctx: Parameters<ReturnType<PluginFactory>['init']>[0]
  ): Promise<void>
  reportError(id: string, error: unknown): void
}
/** Builds a catalog from declarative metadata without importing any plugin code. */
export function createPluginPackageLoader(
  deps: PluginPackageLoaderDependencies
) {
  async function load(
    packages: InstalledPlugin[],
    reservedIds: readonly string[]
  ): Promise<PluginFactory[]> {
    const factories: PluginFactory[] = []
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
          _canRestore: installed.hasPreviousVersion,
          init: (ctx) => deps.activate(manifest, modulePath, ctx),
        }))
      } catch (error) {
        deps.reportError(manifest.id, error)
        if (
          !reservedIds.includes(manifest.id) &&
          /^[A-Za-z0-9][A-Za-z0-9 _-]{0,127}$/.test(manifest.id)
        ) {
          const message = errorMessage(error)
          factories.push(() => ({
            id: manifest.id,
            version: '0.0.0',
            apiVersion: PLUGIN_API_VERSION,
            capabilities: [],
            defaultLocale: 'en-US',
            locales: Object.fromEntries(
              SUPPORTED_PLUGIN_LOCALES.map((locale) => [locale, {}])
            ),
            name: manifest.id,
            _revision: modulePath,
            _external: true,
            _canRestore: installed.hasPreviousVersion,
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
