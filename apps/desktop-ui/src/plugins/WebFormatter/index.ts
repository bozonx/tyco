import {
  formatWebCode,
  WEB_LANGUAGES,
  type WebFormatterConfig,
} from '../../lib/editor/web-formatter'
import type { InputConfigItem } from '../../types'
import type { PluginContext } from '../../types/plugins'

export default function pluginIndex() {
  return {
    name: 'WebFormatter',
    labelKey: 'plugin.webFormatter.label',
    defaultConfig: {
      fields: [
        {
          type: 'select',
          name: 'language',
          labelKey: 'plugin.webFormatter.language',
          defaultValue: 'auto',
          options: WEB_LANGUAGES.map((id) => ({
            id,
            ...(id === 'auto'
              ? { labelKey: 'plugin.webFormatter.auto' }
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
          labelKey: 'plugin.webFormatter.tabWidth',
          defaultValue: 2,
          options: [2, 4, 8].map((id) => ({ id, name: String(id) })),
        },
        {
          type: 'checkbox',
          name: 'useTabs',
          labelKey: 'plugin.webFormatter.useTabs',
          defaultValue: false,
        },
        {
          type: 'text',
          name: 'printWidth',
          labelKey: 'plugin.webFormatter.printWidth',
          defaultValue: 80,
        },
        {
          type: 'checkbox',
          name: 'singleQuote',
          labelKey: 'plugin.webFormatter.singleQuote',
          defaultValue: false,
        },
        {
          type: 'checkbox',
          name: 'semi',
          labelKey: 'plugin.webFormatter.semi',
          defaultValue: true,
        },
        {
          type: 'select',
          name: 'xmlWhitespaceSensitivity',
          labelKey: 'plugin.webFormatter.xmlWhitespace',
          defaultValue: 'preserve',
          options: ['strict', 'preserve', 'ignore'].map((id) => ({
            id,
            labelKey: `plugin.webFormatter.xml${id[0]!.toUpperCase()}${id.slice(1)}`,
          })),
        },
      ] as InputConfigItem[],
    },
    init(ctx: PluginContext) {
      ctx.registerFormatItems([
        {
          id: 'format-formatCode',
          labelKey: 'edit.formatCode',
          action: (text) =>
            formatWebCode(text, ctx.getMyConfig<WebFormatterConfig>()),
        },
      ])
    },
  }
}
