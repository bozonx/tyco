export interface InputConfigOption {
  id: string | number
  name?: string
  labelKey?: string
}

export interface SortableChecklistItem {
  id: string
  enabled: boolean
}

interface InputConfigField<Type extends string, Value> {
  type: Type
  name: string
  label?: string
  labelKey?: string
  info?: string
  infoKey?: string
  value?: Value
  defaultValue?: Value
  options?: InputConfigOption[]
  vertical?: boolean
}

export type InputConfigItem =
  | InputConfigField<'text', string | number>
  | InputConfigField<'textarea', string>
  | InputConfigField<'select', string | number>
  | InputConfigField<'checkbox', boolean>
  | InputConfigField<'sortable-checklist', SortableChecklistItem[]>

/** Copies JSON settings, including reactive objects supplied by a host. */
export function clonePluginValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
