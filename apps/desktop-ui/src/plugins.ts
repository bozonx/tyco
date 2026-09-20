import usePluginContext from './composables/usePluginContext'
import FastNote from './plugins/FastNote'
import RussianStress from './plugins/RussianStress'
import SearchInInternet from './plugins/SearchInInternet'
import type { PluginIndex } from './types/plugins'

export const pluginIndexes: PluginIndex[] = [
  SearchInInternet,
  RussianStress,
  FastNote,
]

export const usePlugins = () => {
  const { use } = usePluginContext()

  pluginIndexes.forEach((pluginIndex) => {
    use(pluginIndex)
  })
}
