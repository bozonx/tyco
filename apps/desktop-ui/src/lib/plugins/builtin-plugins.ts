import FastNote from '@tyco/plugin-fast-note'
import Diacritics from '@tyco/plugin-diacritics'
import TextCase from '@tyco/plugin-text-case'
import WebFormatter from '@tyco/plugin-web-formatter'
import SearchInInternet from '@tyco/plugin-search-in-internet'
import type { PluginIndex } from '../../types/plugins'
import { pluginId } from './plugin-config'

export const builtinPlugins: PluginIndex[] = [
  ...[SearchInInternet, Diacritics, TextCase, WebFormatter, FastNote].map(
    (factory): PluginIndex =>
      () => {
        const plugin = factory()
        return { ...plugin, name: plugin.id }
      }
  ),
]

export const builtinPluginIds = builtinPlugins.map((factory) =>
  pluginId(factory())
)
