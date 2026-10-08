import { PLUGIN_API_VERSION, type PluginDefinition } from '@tyco/plugin-sdk'
import type { InstalledPluginPackage } from '@tyco/shared'

import type { PluginIndex } from '../../types/plugins'

export interface PluginPackageLoaderDependencies {
  importModule(path: string): Promise<{ default?: unknown }>
  reportError(id: string, error: unknown): void
}
/** Imports only entries supplied by the native installation catalog. */
export function createPluginPackageLoader(
  deps: PluginPackageLoaderDependencies
) {
  const cached = new Map<string, PluginIndex>()
  async function load(
    packages: InstalledPluginPackage[],
    reservedIds: readonly string[]
  ): Promise<PluginIndex[]> {
    const factories: PluginIndex[] = []
    const seen = new Set(reservedIds)
    const paths = new Set<string>()
    for (const installed of packages) {
      const { manifest, modulePath } = installed
      try {
        if (seen.has(manifest.id))
          throw new Error(`Duplicate plugin ID: ${manifest.id}`)
        seen.add(manifest.id)
        if (manifest.apiVersion !== PLUGIN_API_VERSION)
          throw new Error('Unsupported plugin API version')
        if (!/^[a-f0-9]+\/[0-9]+\.js$/.test(modulePath))
          throw new Error('Invalid plugin module path')
        let factory = cached.get(modulePath)
        if (!factory) {
          const module = await deps.importModule(modulePath)
          if (typeof module.default !== 'function')
            throw new Error('Plugin must export a factory')
          const create = module.default as () => PluginDefinition
          factory = () => {
            const definition = create()
            if (
              definition.id !== manifest.id ||
              definition.version !== manifest.version ||
              definition.apiVersion !== manifest.apiVersion ||
              typeof definition.init !== 'function'
            )
              throw new Error('Plugin definition does not match its manifest')
            if (
              JSON.stringify(definition.capabilities) !==
              JSON.stringify(manifest.capabilities)
            )
              throw new Error('Plugin capabilities do not match its manifest')
            if (!definition.locales?.[definition.defaultLocale])
              throw new Error('Plugin must include its fallback locale')
            return { ...definition, name: definition.id, _revision: modulePath }
          }
          factory()
          cached.set(modulePath, factory)
        }
        const current = factory()
        if (
          current.id !== manifest.id ||
          current.version !== manifest.version ||
          current.apiVersion !== manifest.apiVersion
        )
          throw new Error('Cached plugin does not match its manifest')
        paths.add(modulePath)
        factories.push(factory)
      } catch (error) {
        deps.reportError(manifest.id, error)
        if (
          !reservedIds.includes(manifest.id) &&
          /^[A-Za-z0-9][A-Za-z0-9 _-]{0,127}$/.test(manifest.id)
        ) {
          const message = error instanceof Error ? error.message : String(error)
          factories.push(() => ({
            ...manifest,
            name: manifest.id,
            labelKey: undefined,
            descriptionKey: undefined,
            _revision: modulePath,
            _loadError: message,
            init: () => {},
          }))
        }
      }
    }
    for (const path of cached.keys()) if (!paths.has(path)) cached.delete(path)
    return factories
  }
  return { load }
}
