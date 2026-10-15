import type { InputConfigOption } from '@tyco/plugin-sdk'

export type ConfigFieldControl =
  | { type: 'text' | 'textarea'; value?: string; placeholder?: string }
  | {
      type: 'select'
      value?: string | number
      options: { id: string | number; name: string; group?: string }[]
    }
  | { type: 'checkbox'; value?: boolean }
  | {
      type: 'sortable-checklist'
      value?: unknown
      options?: InputConfigOption[]
      defaultValue?: unknown
    }
