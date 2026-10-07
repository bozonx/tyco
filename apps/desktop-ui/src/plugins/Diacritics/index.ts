import {
  addDiacritic,
  clearAcute,
  clearDiacritics,
  DIACRITICS,
  type Diacritic,
} from '../../lib/editor/diacritics'
import type { InputConfigItem } from '../../types'
import type { PluginContext } from '../../types/plugins'

export default function pluginIndex() {
  return {
    // Keep the installed ID so existing enabled settings survive the rename.
    name: 'Russian Stress',
    labelKey: 'plugin.diacritics.label',
    descriptionKey: 'plugin.diacritics.description',
    defaultConfig: {
      fields: [
        {
          type: 'select',
          name: 'profile',
          labelKey: 'plugin.diacritics.profile',
          defaultValue: 'general',
          options: ['general', 'russian', 'spanish'].map((id) => ({
            id,
            labelKey: `plugin.diacritics.${id}`,
          })),
        },
      ] as InputConfigItem[],
    },
    init(ctx: PluginContext) {
      const profile =
        ctx.getMyConfig<{ profile: string }>()?.profile ?? 'general'
      const marks: Diacritic[] =
        profile === 'russian'
          ? ['acute']
          : profile === 'spanish'
            ? ['acute', 'diaeresis', 'tilde']
            : (Object.keys(DIACRITICS) as Diacritic[])
      ctx.registerEditItems([
        ...marks.map((kind) => ({
          id: `diacritics-${kind}`,
          selectionOnly: true,
          labelKey: `plugin.diacritics.${kind}`,
          action: (text: string) => addDiacritic(text, kind),
        })),
        {
          id: 'diacritics-clear-acute',
          selectionOnly: true,
          labelKey: 'plugin.diacritics.clearAcute',
          action: clearAcute,
        },
        {
          id: 'diacritics-clear',
          selectionOnly: true,
          labelKey: 'plugin.diacritics.clear',
          action: clearDiacritics,
        },
      ])
    },
  }
}
