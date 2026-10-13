import { shallowReactive } from 'vue'
import type { PluginIcons } from '@tyco/plugin-sdk'

/** Plugin collections stay outside Iconify's permanent global cache. */
export function createPluginIcons() {
  const collections = shallowReactive(new Map<string, PluginIcons>())
  return {
    register: (icons: PluginIcons) => collections.set(icons.prefix, icons),
    remove: (prefix: string) => collections.delete(prefix),
    resolve: (name: string) => {
      const [prefix, key] = name.split(':')
      const collection = collections.get(prefix)
      const icon = collection?.icons[key]
      return icon
        ? {
            width: collection?.width ?? 16,
            height: collection?.height ?? 16,
            ...icon,
          }
        : undefined
    },
  }
}
export const pluginIcons = createPluginIcons()
