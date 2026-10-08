export interface InputConfigOption {
  id: string | number
  name?: string
  labelKey?: string
}

export interface SortableChecklistItem {
  id: string
  enabled: boolean
}

export interface InputConfigItem {
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'sortable-checklist'
  name: string
  label?: string
  labelKey?: string
  value?: unknown
  defaultValue?: unknown
  options?: InputConfigOption[]
  vertical?: boolean
}

/** Copies JSON settings, including reactive objects supplied by a host. */
export function clonePluginValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
