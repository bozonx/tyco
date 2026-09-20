import type { InputConfigItem } from '@/types'

import { type PluginContext } from '../../types/plugins'

export default function pluginIndex() {
  return {
    name: 'SearchInInternet',
    labelKey: 'plugin.searchInInternet.label',
    defaultConfig: {
      fields: [
        {
          type: 'text',
          name: 'url',
          labelKey: 'plugin.searchInInternet.url',
          defaultValue: 'https://duckduckgo.com/?q=',
        } as InputConfigItem,
      ],
    },
    init: (ctx: PluginContext) => {
      ctx.registerActionsItems([
        {
          labelKey: 'action.searchInInternet',
          action: async (text: string) => {
            if (!text?.trim()) {
              ctx.toast('toast.textNotSelected', 'error')
              return
            }

            const pluginConfig = ctx.getUserConfig().plugins
              ?.SearchInInternet as { url?: string } | undefined
            const baseUrl = pluginConfig?.url

            if (!baseUrl) {
              ctx.toast('toast.noSearchBaseUrl', 'warn')
              return
            }

            const url = baseUrl + encodeURIComponent(text)

            await ctx.callApiFunction('openInBrowserAndClose', [url])
          },
        },
      ])
    },
  }
}
