import type { LiveTranscriptState } from '../../lib/stt/live-transcript'
import type { VoiceFinishIntent } from '../../lib/stt/voice-finish-intent'

export interface VoiceRecordingProps {
  transcript: LiveTranscriptState
  audioLevel: number
  audioPeak: number
  recordingDurationMs: number
  isTranscribing: boolean
  isFinishing: boolean
  quickSend?: boolean
  withNext?: boolean
  chat?: boolean
  prefix?: string
  suffix?: string
  context?: string
  finish: (intent?: VoiceFinishIntent) => Promise<void>
  cancel: () => Promise<void>
}
