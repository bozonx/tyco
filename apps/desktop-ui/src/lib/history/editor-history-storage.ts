import {
  DEFAULT_USER_CONFIG,
  EDITOR_HISTORY_STORAGES,
  type EditorHistoryStorage,
} from '@tyco/shared'

/** Retention periods offered by the settings; 0 keeps the entries forever */
export const EDITOR_HISTORY_RETENTION_DAYS = [0, 1, 7, 30, 90] as const

const isLimitZero = (value: unknown): boolean =>
  String(value ?? '').trim() === '0'

/**
 * Where the editor history lives. Configs older than the setting said it with a
 * zero limit (off) and the `clearEditorHistoryOnExit` flag (session)
 */
export function resolveEditorHistoryStorage(
  config: Record<string, unknown>
): EditorHistoryStorage {
  const saved = config.editorHistoryStorage

  if (EDITOR_HISTORY_STORAGES.includes(saved as EditorHistoryStorage)) {
    return saved as EditorHistoryStorage
  }

  if (isLimitZero(config.editorHistoryMaxItems)) return 'off'

  return config.clearEditorHistoryOnExit === true ? 'session' : 'disk'
}

/** The editor history keeps nothing */
export function isEditorHistoryOff(config: Record<string, unknown>): boolean {
  return (
    resolveEditorHistoryStorage(config) === 'off' ||
    isLimitZero(config.editorHistoryMaxItems)
  )
}

/**
 * Brings the editor settings of `config` to the current shape: the storage
 * replaces the legacy flags, and the removed paste and highlighting settings
 * go
 */
export function normalizeEditorConfig(config: Record<string, unknown>): void {
  const storage = resolveEditorHistoryStorage(config)

  // a zero limit meant "off"; that is the storage now, so the limit gets a
  // usable value for when the history is turned on again
  if (storage === 'off' && isLimitZero(config.editorHistoryMaxItems)) {
    config.editorHistoryMaxItems = DEFAULT_USER_CONFIG.editorHistoryMaxItems
  }

  config.editorHistoryStorage = storage
  delete config.clearEditorHistoryOnExit
  delete config.pasteMode
  delete config.editorSyntax
}

/** The offered retention periods plus the saved one if it is not among them */
export function editorHistoryRetentionChoices(saved: unknown): number[] {
  const days = Number(saved)
  const choices: number[] = [...EDITOR_HISTORY_RETENTION_DAYS]

  if (Number.isInteger(days) && days > 0 && !choices.includes(days)) {
    choices.push(days)
    choices.sort((a, b) => a - b)
  }

  return choices
}
