import type { PluginDefinition } from '@tyco/plugin-sdk'
import { locales } from './locales.js'
import {
  addDiacritic,
  clearAcute,
  clearDiacritics,
  type Diacritic,
} from './diacritics.js'
import {
  resolveSortableChecklist,
  type SortableChecklistItem,
} from '@tyco/plugin-sdk'
import type { InputConfigItem, InputConfigOption } from '@tyco/plugin-sdk'
import type { PluginContext, ToolbarItem } from '@tyco/plugin-sdk'

export const DIACRITIC_OPTIONS: InputConfigOption[] = [
  { id: 'acute', labelKey: 'local.acute' },
  { id: 'grave', labelKey: 'local.grave' },
  { id: 'circumflex', labelKey: 'local.circumflex' },
  { id: 'diaeresis', labelKey: 'local.diaeresis' },
  { id: 'tilde', labelKey: 'local.tilde' },
  { id: 'caron', labelKey: 'local.caron' },
  { id: 'macron', labelKey: 'local.macron' },
  { id: 'clearAcute', labelKey: 'local.clearAcute' },
  { id: 'clear', labelKey: 'local.clear' },
]

export const DEFAULT_DIACRITIC_ACTIONS: SortableChecklistItem[] = [
  { id: 'acute', enabled: true },
  { id: 'grave', enabled: false },
  { id: 'circumflex', enabled: false },
  { id: 'diaeresis', enabled: false },
  { id: 'tilde', enabled: false },
  { id: 'caron', enabled: false },
  { id: 'macron', enabled: false },
  { id: 'clearAcute', enabled: false },
  { id: 'clear', enabled: false },
]

const DIACRITIC_SYMBOLS: Record<Diacritic, string> = {
  acute: '◌́',
  grave: '◌̀',
  circumflex: '◌̂',
  diaeresis: '◌̈',
  tilde: '◌̃',
  caron: '◌̌',
  macron: '◌̄',
}

async function executeTransform(
  ctx: PluginContext,
  transform: (text: string) => string
): Promise<void> {
  const selected = await ctx.getEditorInputSelectedText()
  if (!selected) {
    ctx.toast('toast.textNotSelected', 'warn')
    return
  }
  const result = transform(selected)
  ctx.replaceEditorInputSelection(result)
  ctx.setEditorInputFocus()
}

function createToolbarItem(ctx: PluginContext, id: string): ToolbarItem | null {
  if (id === 'clearAcute') {
    return {
      id: 'diacritics-clear-acute',
      label: '−◌́',
      position: 'left',
      selectionOnly: true,
      tooltipKey: 'local.clearAcute',
      action: () => executeTransform(ctx, clearAcute),
    }
  }

  if (id === 'clear') {
    return {
      id: 'diacritics-clear',
      icon: 'mdi:format-clear',
      position: 'left',
      selectionOnly: true,
      tooltipKey: 'local.clear',
      action: () => executeTransform(ctx, clearDiacritics),
    }
  }

  const symbol = DIACRITIC_SYMBOLS[id as Diacritic]
  if (symbol) {
    return {
      id: `diacritics-${id}`,
      label: symbol,
      position: 'left',
      selectionOnly: true,
      tooltipKey: `local.${id}`,
      action: () =>
        executeTransform(ctx, (text) => addDiacritic(text, id as Diacritic)),
    }
  }

  return null
}

export default function pluginIndex(): PluginDefinition {
  return {
    id: 'Diacritics',
    version: '0.1.0',
    apiVersion: 2,
    capabilities: ['editor'],
    defaultLocale: 'en_US',
    locales,
    labelKey: 'local.label',
    descriptionKey: 'local.description',
    defaultConfig: {
      fields: [
        {
          type: 'sortable-checklist',
          name: 'actions',
          labelKey: 'local.actions',
          options: DIACRITIC_OPTIONS,
          defaultValue: DEFAULT_DIACRITIC_ACTIONS,
        },
      ] satisfies InputConfigItem[],
    },
    init(ctx: PluginContext) {
      const config = ctx.getMyConfig<{ actions?: SortableChecklistItem[] }>()

      const actions = resolveSortableChecklist(
        config?.actions,
        DIACRITIC_OPTIONS,
        DEFAULT_DIACRITIC_ACTIONS
      )

      const toolbarItems = actions
        .filter((item) => item.enabled)
        .map((item) => createToolbarItem(ctx, item.id))
        .filter((item): item is ToolbarItem => item !== null)

      ctx.registerToolbarItems(toolbarItems)
    },
  }
}
