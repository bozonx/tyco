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
  isTranscribing: boolean
  isFinishing: boolean
  finishBehavior?: VoiceFinishBehavior
  /** The global hotkey that also confirms the input, see `VoiceRecordingActions` */
  finishHotkey?: string
  chat?: boolean
  prefix?: string
  suffix?: string
  context?: string
  stylingPresets?: (StylingConfig | null)[]
  finish: (intent?: VoiceFinishIntent) => Promise<void>
  finishWithStyle?: (rule: string) => Promise<void>
  cancel: () => Promise<void>
}
