import {
  addDiacritic,
  clearAcute,
  clearDiacritics,
  type Diacritic,
} from '../../lib/editor/diacritics'
import {
  resolveSortableChecklist,
  type SortableChecklistItem,
} from '../../lib/plugins/sortable-checklist'
import type { InputConfigItem, InputConfigOption } from '../../types'
import type { PluginContext, ToolbarItem } from '../../types/plugins'

export const DIACRITIC_OPTIONS: InputConfigOption[] = [
  { id: 'acute', labelKey: 'plugin.diacritics.acute' },
  { id: 'grave', labelKey: 'plugin.diacritics.grave' },
  { id: 'circumflex', labelKey: 'plugin.diacritics.circumflex' },
  { id: 'diaeresis', labelKey: 'plugin.diacritics.diaeresis' },
  { id: 'tilde', labelKey: 'plugin.diacritics.tilde' },
  { id: 'caron', labelKey: 'plugin.diacritics.caron' },
  { id: 'macron', labelKey: 'plugin.diacritics.macron' },
  { id: 'clearAcute', labelKey: 'plugin.diacritics.clearAcute' },
  { id: 'clear', labelKey: 'plugin.diacritics.clear' },
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

function executeTransform(
  ctx: PluginContext,
  transform: (text: string) => string
): void {
  const selected = ctx.getEditorInputSelectedText()
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
      tooltipKey: 'plugin.diacritics.clearAcute',
      action: () => executeTransform(ctx, clearAcute),
    }
  }

  if (id === 'clear') {
    return {
      id: 'diacritics-clear',
      icon: 'mdi:format-clear',
      position: 'left',
      selectionOnly: true,
      tooltipKey: 'plugin.diacritics.clear',
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
      tooltipKey: `plugin.diacritics.${id}`,
      action: () =>
        executeTransform(ctx, (text) => addDiacritic(text, id as Diacritic)),
    }
  }

  return null
}

export default function pluginIndex() {
  return {
    // Keep the installed ID so existing enabled settings survive the rename.
    name: 'Russian Stress',
    labelKey: 'plugin.diacritics.label',
    descriptionKey: 'plugin.diacritics.description',
    defaultConfig: {
      fields: [
        {
          type: 'sortable-checklist',
          name: 'actions',
          labelKey: 'plugin.diacritics.actions',
          options: DIACRITIC_OPTIONS,
          defaultValue: DEFAULT_DIACRITIC_ACTIONS,
        },
      ] as InputConfigItem[],
    },
    init(ctx: PluginContext) {
      const config = ctx.getMyConfig<{
        actions?: SortableChecklistItem[]
        profile?: string
      }>()

      let defaultActions = DEFAULT_DIACRITIC_ACTIONS
      if (!config?.actions && config?.profile) {
        if (config.profile === 'russian') {
          defaultActions = [{ id: 'acute', enabled: true }]
        } else if (config.profile === 'spanish') {
          defaultActions = [
            { id: 'acute', enabled: true },
            { id: 'diaeresis', enabled: true },
            { id: 'tilde', enabled: true },
          ]
        } else if (config.profile === 'general') {
          defaultActions = DIACRITIC_OPTIONS.map((opt) => ({
            id: String(opt.id),
            enabled: true,
          }))
        }
      }

      const actions = resolveSortableChecklist(
        config?.actions,
        DIACRITIC_OPTIONS,
        defaultActions
      )

      const toolbarItems = actions
        .filter((item) => item.enabled)
        .map((item) => createToolbarItem(ctx, item.id))
        .filter((item): item is ToolbarItem => item !== null)

      ctx.registerToolbarItems(toolbarItems)
    },
  }
}
