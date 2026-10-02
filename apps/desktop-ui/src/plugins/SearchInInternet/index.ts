import type { InputConfigItem } from '@/types'

import { type PluginContext } from '../../types/plugins'

export const DEFAULT_SEARCH_URL = 'https://duckduckgo.com/?q='

interface SearchInInternetConfig {
  url: string
}

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
          defaultValue: DEFAULT_SEARCH_URL,
        } as InputConfigItem,
      ],
    },
    init: (ctx: PluginContext) => {
      const search = async (input?: string) => {
        const text = (
          input ??
          (ctx.getEditorInputSelectedText() || ctx.getEditorInputValue())
        ).trim()

        if (!text) {
          ctx.toast('toast.textNotSelected', 'error')
          return
        }

        // Settings are stored only after the user saves them once
        const baseUrl =
          ctx.getMyConfig<SearchInInternetConfig>()?.url ?? DEFAULT_SEARCH_URL

        if (!baseUrl.trim()) {
          ctx.toast('toast.noSearchBaseUrl', 'warn')
          return
        }

        const result = await ctx.callApiFunction('openInBrowserAndClose', [
          baseUrl.trim() + encodeURIComponent(text),
        ])
        if (!result.success) {
          ctx.toast('toast.openInBrowserFailed', 'error')
        }
      }

      ctx.registerActionsItems([
        {
          id: 'searchInInternet',
          preferredKey: 'v',
          labelKey: 'plugin.searchInInternet.label',
          icon: 'mdi:web',
          action: search,
        },
      ])

      ctx.registerToolbarItems([
        {
          id: 'searchInInternet',
          icon: 'mdi:web',
          tooltipKey: 'plugin.searchInInternet.label',
          position: 'right',
          action: () => search(),
        },
      ])
    },
  }
}
