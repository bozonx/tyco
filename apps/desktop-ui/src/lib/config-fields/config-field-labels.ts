import type { InputConfigItem, InputConfigOption } from '@tyco/plugin-sdk'

type Translate = (key: string) => string

export function configFieldLabel(field: InputConfigItem, t: Translate): string {
  return field.labelKey ? t(field.labelKey) : field.label || field.name
}

export function configOptionLabel(
  option: InputConfigOption,
  t: Translate
): string {
  return option.labelKey ? t(option.labelKey) : option.name || String(option.id)
}

export function configFieldOptions(field: InputConfigItem, t: Translate) {
  return (field.options ?? []).map((option) => ({
    id: option.id,
    name: configOptionLabel(option, t),
  }))
}
