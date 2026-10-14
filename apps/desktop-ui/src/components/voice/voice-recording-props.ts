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
  chat?: boolean
  prefix?: string
  suffix?: string
  context?: string
  finish: (intent?: VoiceFinishIntent) => Promise<void>
  cancel: () => Promise<void>
}
