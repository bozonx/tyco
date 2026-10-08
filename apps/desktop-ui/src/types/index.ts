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

export type {
  InputConfigOption,
  InputConfigItem,
  SortableChecklistItem,
} from '@tyco/plugin-sdk'
