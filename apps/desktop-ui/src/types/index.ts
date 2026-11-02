export enum LlmInstructionKind {
  VOICE_CORRECTION = 'voiceCorrection',
  CORRECTION = 'correction',
  TRANSFORMATION = 'transformation',
  STYLING = 'styling',
  CHAT = 'chat',
}

export { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

export type { InputConfigOption, InputConfigItem } from '@tyco/plugin-sdk'
