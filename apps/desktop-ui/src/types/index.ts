import type { InitParams, IpcResult } from '@tyco/shared'

export type { InitParams, IpcResult }

// TODO: оже есть в composables/useGlobalEvents.ts
export enum GlobalEvents {
  KEY_UP,
}

export enum AI_TASKS {
  TRANSLATE = 'translate',
  VOICE_CORRECTION = 'voiceCorrection',
  CORRECTION = 'correction',
  AI_TASKS = 'aiTasks',
  CHAT = 'chat',
}

export const PRESETS_KEYS = [
  'q',
  'w',
  'e',
  'r',
  't',

  'a',
  's',
  'd',
  'f',
  'g',

  'z',
  'x',
  'c',
  'v',
  'b',
]

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
  value?: any
  defaultValue?: any
  options?: InputConfigOption[]
  vertical?: boolean
}
