/** IPC-only transport types. Channel implementations are owned by the adapter. */
export interface DesktopChannel {
  readonly id: number
}

export interface InputRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FetchRequest {
  method: string
  url: string
  headers: [string, string][]
  body?: string | null
  purpose?: 'chat-image'
}

export interface SocketRequest {
  url: string
  headers: [string, string][]
  protocols: string[]
}

export interface VoiceCaptureInfo {
  sampleRate: number
  sessionId: number
}

export interface SecretStatus {
  origins: string[]
  available: boolean
}

export type SecretsStatus = Record<string, SecretStatus>
export type VaultState = 'available' | 'unavailable'

export interface JobCompletion {
  success: boolean
  cancelled?: boolean
  output?: string | null
  message?: string | null
  code?: string | null
}

export interface ExternalJob {
  id: string
  commandId: string
  state: 'accepted' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  output?: string
  error?: string
  code?: string
}

export type FetchEvent =
  | {
      type: 'head'
      status: number
      statusText: string
      headers: [string, string][]
    }
  | { type: 'end' }
  | { type: 'error'; message: string }

export type SocketEvent =
  | { type: 'open' }
  | { type: 'message'; data: string }
  | { type: 'close'; code: number; reason: string }
  | { type: 'error'; message: string }

export type VoiceCaptureEvent =
  { type: 'end' } | { type: 'error'; message: string }
