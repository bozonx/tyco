import { MAX_PROFILE_TEMPERATURE } from '@tyco/shared'

/**
 * A number typed in a model setting: empty leaves the setting to the model,
 * `isValid` is false for anything the setting cannot take
 */
export interface ParsedModelNumber {
  value?: number
  isValid: boolean
}

/** A number typed in a setting that may be left empty */
export function parseOptionalNumber(
  text: string,
  isAllowed: (value: number) => boolean
): ParsedModelNumber {
  const trimmed = text.trim()
  if (!trimmed) return { isValid: true }
  const value = Number(trimmed)
  return isAllowed(value) ? { value, isValid: true } : { isValid: false }
}

export const parseModelTemperature = (text: string): ParsedModelNumber =>
  parseOptionalNumber(
    text,
    (value) =>
      Number.isFinite(value) && value >= 0 && value <= MAX_PROFILE_TEMPERATURE
  )

export const parseModelTokenCount = (text: string): ParsedModelNumber =>
  parseOptionalNumber(text, (value) => Number.isSafeInteger(value) && value > 0)
