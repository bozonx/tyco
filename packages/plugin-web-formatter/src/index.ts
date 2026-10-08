import type { PluginDefinition } from '@tyco/plugin-sdk'
import { locales } from './locales.js'
import {
  formatWebCode,
  WEB_LANGUAGES,
  type WebFormatterConfig,
} from './web-formatter.js'
import type { InputConfigItem } from '@tyco/plugin-sdk'
import type { PluginContext } from '@tyco/plugin-sdk'

export default function pluginIndex(): PluginDefinition {
  return {
    id: 'WebFormatter',
    version: '0.1.0',
    apiVersion: 1,
    capabilities: ['editor'],
    defaultLocale: 'en_US',
    locales,
    labelKey: 'local.label',
    descriptionKey: 'local.description',
    defaultConfig: {
      fields: [
        {
          type: 'select',
          name: 'language',
          labelKey: 'local.language',
          defaultValue: 'auto',
          options: WEB_LANGUAGES.map((id) => ({
            id,
            ...(id === 'auto'
              ? { labelKey: 'local.auto' }
              : {
                  name:
                    id === 'javascript'
                      ? 'JavaScript'
                      : id === 'typescript'
                        ? 'TypeScript'
                        : id.toUpperCase(),
                }),
          })),
        },
        {
          type: 'select',
          name: 'tabWidth',
          labelKey: 'local.tabWidth',
          defaultValue: 2,
          options: [2, 4, 8].map((id) => ({ id, name: String(id) })),
        },
        {
          type: 'checkbox',
          name: 'useTabs',
          labelKey: 'local.useTabs',
          defaultValue: false,
        },
        {
          type: 'text',
          name: 'printWidth',
          labelKey: 'local.printWidth',
          defaultValue: 80,
        },
        {
          type: 'checkbox',
          name: 'singleQuote',
          labelKey: 'local.singleQuote',
          defaultValue: false,
        },
        {
          type: 'checkbox',
          name: 'semi',
          labelKey: 'local.semi',
          defaultValue: true,
        },
        {
          type: 'select',
          name: 'xmlWhitespaceSensitivity',
          labelKey: 'local.xmlWhitespace',
          defaultValue: 'preserve',
          options: ['strict', 'preserve', 'ignore'].map((id) => ({
            id,
            labelKey: `local.xml${id[0]!.toUpperCase()}${id.slice(1)}`,
          })),
        },
      ] satisfies InputConfigItem[],
    },
    init(ctx: PluginContext) {
      ctx.registerFormatItems([
        {
          id: 'format-formatCode',
          labelKey: 'local.formatCode',
          action: (text) =>
            formatWebCode(text, ctx.getMyConfig<WebFormatterConfig>()),
        },
      ])
    },
  }
}
