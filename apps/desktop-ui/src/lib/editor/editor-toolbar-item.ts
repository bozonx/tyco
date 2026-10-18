import type { ToolbarItem } from '../../types/plugins'

/** The label of a button that acts on the selection when there is one */
export function scopedActionLabel(
  label: string,
  hasSelection: boolean,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  return hasSelection
    ? t('editor.appliesToSelection', { action: label })
    : label
}

export function getToolbarTooltip(
  item: ToolbarItem,
  t: (key: string) => string
): string {
  if (item.tooltipKey) {
    return t(item.tooltipKey)
  }
  if (item.tooltip) {
    return item.tooltip
  }
  if (item.labelKey) {
    return t(item.labelKey)
  }
  return item.label || ''
}

export function getToolbarLabel(
  item: ToolbarItem,
  t: (key: string) => string
): string {
  if (item.label) return item.label
  if (item.labelKey) return t(item.labelKey)
  return ''
}

export function isToolbarItemSquare(label: string): boolean {
  return !label || label.length <= 2
}

export function isToolbarItemDisabled(
  item: ToolbarItem,
  hasSelection: boolean
): boolean {
  return Boolean(item.disabled || (item.selectionOnly && !hasSelection))
}
