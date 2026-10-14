export enum AiTaskKind {
  VOICE_CORRECTION = 'voiceCorrection',
  CORRECTION = 'correction',
  AI_TASKS = 'aiTasks',
  CHAT = 'chat',
}

export const SHORTCUT_SLOT_KEYS = [
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

export type { InputConfigOption, InputConfigItem } from '@tyco/plugin-sdk'
