import type { PluginDefinition } from '@tyco/plugin-sdk'
import { locales } from './locales.js'
import type { InputConfigItem } from '@tyco/plugin-sdk'

import { runToolFromToolbar } from '@tyco/plugin-sdk'
import {
  type PluginContext,
  TEXT_INPUT_SCHEMA,
  type ToolDefinition,
} from '@tyco/plugin-sdk'

export const DEFAULT_SEARCH_URL = 'https://duckduckgo.com/?q='

/** Longer texts are not a query: the whole document was sent by mistake */
export const MAX_SEARCH_LENGTH = 500

const urlField: InputConfigItem = {
  type: 'text',
  name: 'url',
  labelKey: 'local.url',
  defaultValue: DEFAULT_SEARCH_URL,
}

export default function pluginIndex(): PluginDefinition {
  return {
    id: 'SearchInInternet',
    version: '0.1.0',
    apiVersion: 2,
    capabilities: ['editor', 'browser'],
    defaultLocale: 'en_US',
    locales,
    labelKey: 'local.label',
    descriptionKey: 'local.description',
    defaultConfig: { fields: [urlField] },
    init: (ctx: PluginContext) => {
      const search: ToolDefinition = {
        id: 'search',
        labelKey: 'local.label',
        descriptionKey: 'local.description',
        icon: 'mdi:web',
        description: 'Opens a web search for the text in the browser',
        inputSchema: TEXT_INPUT_SCHEMA,
        configFields: [urlField],
        defaultCommands: [
          {
            id: 'search',
            nameKey: 'local.label',
            phrasesKey: 'local.phrases',
            menu: { preferredKey: 'v' },
          },
        ],
        run: async ({ input, config }) => {
          const text = String(input.text ?? '').trim()
          if (!text) {
            return {
              ok: false,
              level: 'warn',
              messageKey: 'toast.textNotSelected',
            }
          }
          if (text.length > MAX_SEARCH_LENGTH) {
            return {
              ok: false,
              level: 'warn',
              messageKey: 'local.textTooLongForSearch',
            }
          }
          // the settings are stored only after the user saves them once
          const baseUrl =
            typeof config.url === 'string' ? config.url : DEFAULT_SEARCH_URL
          if (!baseUrl.trim()) {
            return {
              ok: false,
              level: 'warn',
              messageKey: 'local.noSearchBaseUrl',
            }
          }
          const result = await ctx.callApiFunction('openInBrowserAndClose', [
            baseUrl.trim() + encodeURIComponent(text),
          ])
          return result.success
            ? // the browser has the focus, and the window is hidden already
              { ok: true, keepWindow: true }
            : { ok: false, messageKey: 'local.openInBrowserFailed' }
        },
      }

      ctx.registerTools([search])

      ctx.registerToolbarItems([
        {
          id: 'searchInInternet',
          icon: 'mdi:web',
          tooltipKey: 'local.label',
          position: 'right',
          action: () => runToolFromToolbar(ctx, search),
        },
      ])
    },
  }
}
