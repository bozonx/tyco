import type { InputConfigItem } from './config.js'
import { resolveSortableChecklist } from './sortable-checklist.js'

/** Validates saved values before attaching them to a declared field. */
export function withConfigFieldValue(
  field: InputConfigItem,
  value: unknown
): InputConfigItem {
  switch (field.type) {
    case 'checkbox':
      return {
        ...field,
        value:
          typeof value === 'boolean' ? value : (field.defaultValue ?? false),
      }
    case 'textarea':
      return {
        ...field,
        value: typeof value === 'string' ? value : (field.defaultValue ?? ''),
      }
    case 'text':
      return {
        ...field,
        value:
          typeof value === 'string' ||
          (typeof field.defaultValue === 'number' &&
            typeof value === 'number' &&
            Number.isFinite(value))
            ? value
            : (field.defaultValue ?? ''),
      }
    case 'select': {
      const selected = field.options?.find((option) => option.id === value)
      const fallback = field.options?.find(
        (option) => option.id === field.defaultValue
      )
      return { ...field, value: selected?.id ?? fallback?.id }
    }
    case 'sortable-checklist':
      return {
        ...field,
        value: resolveSortableChecklist(
          value,
          field.options,
          field.defaultValue
        ),
      }
  }
}

/** Whether a field is shown for these values of its form; see `visibleWhen`. */
export function isConfigFieldVisible(
  field: InputConfigItem,
  values: Record<string, unknown>
): boolean {
  if (!field.visibleWhen) return true
  return field.visibleWhen.equals.some(
    (expected) => expected === values[field.visibleWhen!.field]
  )
}
