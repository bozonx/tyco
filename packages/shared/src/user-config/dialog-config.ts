/** What the dialog listens to: both sides apart, or the computer alone */
export type DialogSource = 'microphoneAndSystem' | 'system'

/** Saved dialogs live on the disk or are not kept at all */
export const DIALOG_HISTORY_STORAGES = ['off', 'disk'] as const
export type DialogHistoryStorage = (typeof DIALOG_HISTORY_STORAGES)[number]

export interface DialogHistoryConfig {
  storage: DialogHistoryStorage
  /** Absent: dialogs are kept indefinitely */
  retentionDays?: number
}

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
  history: DialogHistoryConfig
  /**
   * The language the other side is translated into, by the model of
   * `llm.tasks.dialogTranslation`; empty: no translation
   */
  translationTargetLanguage: string
  /**
   * The language spoken by the other side when using Deepgram; empty or 'auto':
   * automatic language detection
   */
  remoteLanguage?: string
  /**
   * The language the user speaks; empty or absent: the language of the
   * dictation
   */
  ownLanguage?: string
  /**
   * A translated turn of the other side shows its translation alone, without
   * the original under it
   */
  isTranslationOnly: boolean
  /** Where the compact strip was last, on this device */
  compactGeometry?: DialogWindowGeometry
  /** The user was told to ask the other side before recording */
  isRecordingNoticeAcknowledged?: boolean
  /** The user was told to use headphones to avoid echo during a call */
  isHeadphonesNoticeAcknowledged?: boolean
  /**
   * A call is recorded in one channel, both sides together; otherwise the
   * microphone left and the computer sound right
   */
  isRecordingMixedDown: boolean
  /**
   * A call is recorded as the speech recognition hears it, the echo of the
   * speakers lowered and the peaks limited; otherwise as captured
   */
  isRecordingProcessed: boolean
}
