import type { StylingConfig } from '@tyco/shared'
import type { LiveTranscriptState } from '../../lib/stt/live-transcript'
import type {
  VoiceFinishBehavior,
  VoiceFinishIntent,
} from '../../lib/stt/voice-finish-intent'

export interface VoiceRecordingProps {
  transcript: LiveTranscriptState
  audioLevel: number
  audioPeak: number
  recordingDurationMs: number
  /** When the recording stops by itself, once that is near */
  autoStopDeadlineMs?: number
  isTranscribing: boolean
  isCorrecting?: boolean
  isStyling?: boolean
  isFinishing: boolean
  finishBehavior?: VoiceFinishBehavior
  /** The global hotkey that also confirms the input, see `VoiceRecordingActions` */
  finishHotkey?: string
  chat?: boolean
  /**
   * Shows a labelled Cancel button with the Esc key instead of an icon cross in
   * compact chat mode.
   */
  cancelShortcut?: boolean
  showCancelButton?: boolean
  prefix?: string
  suffix?: string
  context?: string
  /** The listened message this dictation replies to */
  referenceText?: string
  replyTo?: string
  /** Shows the switch to listening, see `QuickModeSwitch` */
  canSwitchMode?: boolean
  microphoneId?: string
  selectMicrophone?: (id: string) => Promise<void>
  stylingPresets?: (StylingConfig | null)[]
  finish: (intent?: VoiceFinishIntent) => Promise<void>
  finishWithStyle?: (rule: string) => Promise<void>
  cancel: () => Promise<void>
}
