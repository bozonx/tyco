import type { TranslationProvider } from './translation-config'

/** What the dialog listens to: both sides apart, or the computer alone */
export type DialogSource = 'microphoneAndSystem' | 'system'
/** What a remote turn shows: its translation, the original, or both */
export type DialogTextDisplay = 'translation' | 'original' | 'both'

/** The strip of the compact dialog, in physical pixels of the desktop */
export interface DialogWindowGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface DialogConfig {
  /** Whether the dialog mode is offered: its tab, its view and its settings */
  isEnabled: boolean
  source: DialogSource
  /** The language the other side is translated into; empty: no translation */
  translationTargetLanguage: string
  textDisplay: DialogTextDisplay
  /** `default`: the provider of the translation settings */
  translationProvider: 'default' | TranslationProvider
  /** Where the compact strip was last, on this device */
  compactGeometry?: DialogWindowGeometry
  /** Where call recordings go on this device; empty: the music folder */
  recordingsFolder?: string
  /** The user was told to ask the other side before recording */
  isRecordingNoticeAcknowledged?: boolean
}
