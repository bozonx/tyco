import { errorMessage } from '@tyco/shared/value-guards'

/**
 * Why a dictation failed, told to the user by `kind`:
 *
 * - `microphone`: the microphone did not start;
 * - `microphoneLost`: it stopped while recording, e.g. the device went away;
 * - `overflow`: the speech service fell behind the recording;
 * - `provider`: the speech service failed;
 * - `closed`: the service ended the session while recording;
 * - `timeout`: the service did not send its last words in time;
 * - `superseded`: another voice input took the microphone over.
 */
export type DictationErrorKind =
  | 'microphone'
  | 'microphoneLost'
  | 'overflow'
  | 'provider'
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
  closed: 'toast.dictationClosed',
  timeout: 'toast.dictationTimeout',
  superseded: 'toast.dictationSuperseded',
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
  return new DictationError(kind, details, details)
}

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
  const details = (error as DictationError).details?.trim()
  const message = translate(key)
  return details ? `${message}: ${details}` : message
}
