import { errorMessage } from '@tyco/shared/value-guards'

/**
 * Why a dictation failed, told to the user by `kind`:
 *
 * - `microphone`: the microphone did not start;
 * - `microphoneLost`: it stopped while recording, e.g. the device went away;
 * - `overflow`: the speech service fell behind the recording;
 * - `provider`: the speech service failed;
 * - `connection`: could not reach the speech recognition service;
 * - `localServerUnavailable`: could not connect to the local STT server;
 * - `auth`: the API key was rejected by the speech service;
 * - `missingKey`: no API key saved for the configured provider;
 * - `keyUnavailable`: the saved API key cannot be read from the keychain;
 * - `incompleteConfig`: the provider model or server address is invalid;
 * - `closed`: the service ended the session while recording;
 * - `timeout`: the service did not send its last words in time;
 * - `superseded`: another voice input took the microphone over.
 */
export type DictationErrorKind =
  | 'microphone'
  | 'microphoneLost'
  | 'overflow'
  | 'provider'
  | 'connection'
  | 'localServerUnavailable'
  | 'auth'
  | 'missingKey'
  | 'keyUnavailable'
  | 'incompleteConfig'
  | 'closed'
  | 'timeout'
  | 'superseded'

/**
 * A failure of the dictation itself. `details` is what the system or the
 * service said, in its own words; the user reads it after a message of ours.
 */
export class DictationError extends Error {
  constructor(
    readonly kind: DictationErrorKind,
    message: string,
    readonly details?: string
  ) {
    super(message)
    this.name = 'DictationError'
  }
}

const DICTATION_ERROR_KEYS: Record<DictationErrorKind, string> = {
  microphone: 'toast.microphoneStartFailed',
  microphoneLost: 'toast.microphoneStopped',
  overflow: 'toast.dictationOverflow',
  provider: 'toast.sttServiceFailed',
  connection: 'toast.sttConnectionFailed',
  localServerUnavailable: 'toast.sttLocalServerUnavailable',
  auth: 'toast.sttAuthFailed',
  missingKey: 'toast.voiceKeyMissing',
  keyUnavailable: 'toast.voiceKeyUnavailable',
  incompleteConfig: 'toast.sttModelIncomplete',
  closed: 'toast.dictationClosed',
  timeout: 'toast.dictationTimeout',
  superseded: 'toast.dictationSuperseded',
}

/**
 * Errors that can be fixed in Transcription settings (missing/invalid key,
 * missing model/URL, or unreachable self-hosted server).
 */
export function isSettingsFixableDictationError(error: unknown): boolean {
  return (
    error instanceof DictationError &&
    (error.kind === 'missingKey' ||
      error.kind === 'incompleteConfig' ||
      error.kind === 'auth' ||
      error.kind === 'localServerUnavailable')
  )
}

/** Errors where retrying the connection makes sense. */
export function isRetryableDictationError(error: unknown): boolean {
  return (
    error instanceof DictationError &&
    (error.kind === 'connection' ||
      error.kind === 'localServerUnavailable' ||
      error.kind === 'timeout' ||
      error.kind === 'closed')
  )
}

const AUTH_ERROR_RE =
  /\b(?:401|403|unauthorized|forbidden|authentication)\b|invalid.{0,20}(?:api.?key|token|credentials)/i
const LOCAL_REFUSED_RE = /connection refused|econnrefused/i
const CONNECTION_ERROR_RE =
  /failed to lookup address|dns error|enotfound|etimedout|econnreset|ehostunreach|network is unreachable|timed out|socket closed before opening|connection closed without a close frame|closed with 1006|without confirming the final transcription|tls|certificate|broken pipe|unexpected eof|fetch failed|network error/i

function classifyProviderError(message: string): DictationErrorKind {
  if (AUTH_ERROR_RE.test(message)) return 'auth'
  if (LOCAL_REFUSED_RE.test(message)) return 'localServerUnavailable'
  if (CONNECTION_ERROR_RE.test(message)) return 'connection'
  return 'provider'
}

/** The message key of a dictation failure; other errors carry their own text */
export function dictationErrorKey(error: unknown): string | undefined {
  return error instanceof DictationError
    ? DICTATION_ERROR_KEYS[error.kind]
    : undefined
}

/** `error` as `kind`, keeping what it said as the details */
export function asDictationError(
  kind: DictationErrorKind,
  error: unknown
): DictationError {
  if (error instanceof DictationError) return error
  const details = errorMessage(error)
  const resolvedKind =
    kind === 'provider' ? classifyProviderError(details) : kind
  return new DictationError(resolvedKind, details, details)
}

const SELF_CONTAINED_KINDS: ReadonlySet<DictationErrorKind> = new Set([
  'connection',
  'localServerUnavailable',
  'auth',
  'incompleteConfig',
])

/**
 * What went wrong, in the user's language where the message is ours; the
 * details follow as they came
 */
export function describeDictationError(
  error: unknown,
  translate: (key: string, params?: Record<string, string>) => string
): string {
  const key = dictationErrorKey(error)
  if (!key) return errorMessage(error)
  const dictationError = error as DictationError
  if (
    dictationError.kind === 'missingKey' ||
    dictationError.kind === 'keyUnavailable'
  ) {
    return dictationError.message
  }
  const message = translate(key)
  if (SELF_CONTAINED_KINDS.has(dictationError.kind)) return message
  const details = dictationError.details?.trim()
  return details ? `${message}: ${details}` : message
}
