import type {
  CommandConfig,
  CommandRunRecord,
  CommandRunSource,
} from '@tyco/shared'

import { commandLabel } from './command-runtime'

/** The log entry of one command run; `input` is null for a command without */
export function commandRunRecord(
  command: CommandConfig,
  source: CommandRunSource,
  input: string | null,
  outcome: { success: boolean; message?: string | null }
): CommandRunRecord {
  const record: CommandRunRecord = {
    commandId: command.id,
    name: commandLabel(command),
    source,
    success: outcome.success,
  }
  if (input !== null) record.text = input
  if (outcome.message) record.message = outcome.message
  return record
}

/**
 * Logs a run without making the caller wait; a failure to log, even a thrown
 * one, goes to `reportError`
 */
export function logCommandRun(
  deps: {
    logRun?: (record: CommandRunRecord) => Promise<void> | void
    reportError?: (error: unknown) => void
  },
  record: CommandRunRecord
): void {
  void Promise.resolve()
    .then(() => deps.logRun?.(record))
    .catch((error: unknown) => deps.reportError?.(error))
}
