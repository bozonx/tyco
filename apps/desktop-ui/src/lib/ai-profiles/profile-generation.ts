import { MAX_PROFILE_TEMPERATURE } from '@tyco/shared'

/**
 * A number typed in a profile setting: empty leaves the setting to the model,
 * `isValid` is false for anything the setting cannot take
 */
export interface ParsedProfileNumber {
  value?: number
  isValid: boolean
}

export function parseProfileTemperature(text: string): ParsedProfileNumber {
  const trimmed = text.trim()
  if (!trimmed) return { isValid: true }
  const value = Number(trimmed)
  return Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_PROFILE_TEMPERATURE
    ? { value, isValid: true }
    : { isValid: false }
}

export function parseProfileMaxOutputTokens(text: string): ParsedProfileNumber {
  const trimmed = text.trim()
  if (!trimmed) return { isValid: true }
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value > 0
    ? { value, isValid: true }
    : { isValid: false }
}
