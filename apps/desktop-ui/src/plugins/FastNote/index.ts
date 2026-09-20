import type { InputConfigItem } from '@/types'
import type { PluginContext } from '@/types/plugins'

export default function pluginIndex() {
  return {
    name: 'FastNote',
    labelKey: 'plugin.fastNote.label',
    defaultConfig: {
      fields: [
        {
          type: 'text',
          name: 'pathToNotes',
          labelKey: 'plugin.fastNote.pathToNotes',
          defaultValue: '',
        } as InputConfigItem,
      ],
    },
    init: (ctx: PluginContext) => {
      ctx.registerActionsItems([
        {
          labelKey: 'plugin.fastNote.label',
          action: async (text: string) => {
            console.log('Fast Note', text)
          },
        },
      ])
    },
  }
}
