import { APP_CONFIG } from '@tyco/shared'

/**
 * Matches characters from Han (Chinese), Hiragana, Katakana, and Hangul
 * (Korean) scripts.
 */
export function isCjkText(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    text
  )
}

export interface ActionTextValidation {
  valid: boolean
  reason?: 'empty' | 'tooShort'
  hintKey?: string
  toastKey?: string
  toastKind?: 'warn' | 'error'
}

/** Whether the action strictly requires source text / context to operate. */
export function actionRequiresContext(actionId?: string): boolean {
  if (!actionId) return false
  return (
    actionId === 'correction' ||
    actionId === 'directCorrection' ||
    actionId === 'insertIntoWindow' ||
    actionId === 'copyToClipboard' ||
    actionId === 'applyToEditor' ||
    actionId === 'transformationMenu' ||
    actionId.startsWith('transformation:') ||
    actionId === 'stylingMenu' ||
    actionId.startsWith('styling:') ||
    actionId === 'translationMenu' ||
    actionId.startsWith('translation:')
  )
}

export interface ActionTextValidationOptions {
  minCorrectionLength?: number
}

/**
 * Validates text against requirements of a menu action. Returns `valid: true`
 * if the action does not require text or the text is sufficient.
 */
export function validateActionText(
  actionId: string | undefined,
  text: string | null | undefined,
  options?: ActionTextValidationOptions
): ActionTextValidation {
  if (!actionId || !actionRequiresContext(actionId)) {
    return { valid: true }
  }

  const trimmed = text?.trim() ?? ''
  if (!trimmed) {
    return {
      valid: false,
      reason: 'empty',
      hintKey: 'menu.contextRequired',
      toastKey: 'toast.textNotSelected',
      toastKind: 'error',
    }
  }

  if (actionId === 'correction' || actionId === 'directCorrection') {
    const minLength =
      options?.minCorrectionLength ?? APP_CONFIG.minCorrectionLength
    if (trimmed.length < minLength) {
      return {
        valid: false,
        reason: 'tooShort',
        hintKey: 'write.textTooShortForCorrection',
        toastKey: 'toast.textTooShortForCorrection',
        toastKind: 'warn',
      }
    }
  }

  if (
    actionId === 'transformationMenu' ||
    actionId.startsWith('transformation:')
  ) {
    if (trimmed.length < APP_CONFIG.minTransformationLength) {
      return {
        valid: false,
        reason: 'tooShort',
        hintKey: 'toast.textTooShortToProcess',
        toastKey: 'toast.textTooShortToProcess',
        toastKind: 'warn',
      }
    }
  }

  if (actionId === 'stylingMenu' || actionId.startsWith('styling:')) {
    if (trimmed.length < APP_CONFIG.minStylingLength) {
      return {
        valid: false,
        reason: 'tooShort',
        hintKey: 'toast.textTooShortToProcess',
        toastKey: 'toast.textTooShortToProcess',
        toastKind: 'warn',
      }
    }
  }

  if (actionId === 'translationMenu' || actionId.startsWith('translation:')) {
    if (
      !isCjkText(trimmed) &&
      trimmed.length < APP_CONFIG.minTranslationLength
    ) {
      return {
        valid: false,
        reason: 'tooShort',
        hintKey: 'toast.textTooShortToTranslate',
        toastKey: 'toast.textTooShortToTranslate',
        toastKind: 'warn',
      }
    }
  }

  return { valid: true }
}
