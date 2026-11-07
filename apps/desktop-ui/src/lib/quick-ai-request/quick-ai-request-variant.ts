import { ActivationMode } from '@tyco/shared'

/** How an activation starts a quick request: the input and what it is about */
export interface QuickAiRequestVariant {
  inputMode: 'text' | 'voice'
  isScreenshot: boolean
}

const VARIANTS: Partial<Record<ActivationMode, QuickAiRequestVariant>> = {
  [ActivationMode.QUICK_AI_REQUEST]: { inputMode: 'text', isScreenshot: false },
  [ActivationMode.VOICE_QUICK_AI_REQUEST]: {
    inputMode: 'voice',
    isScreenshot: false,
  },
  [ActivationMode.SCREENSHOT_QUICK_AI_REQUEST]: {
    inputMode: 'text',
    isScreenshot: true,
  },
  [ActivationMode.VOICE_SCREENSHOT_QUICK_AI_REQUEST]: {
    inputMode: 'voice',
    isScreenshot: true,
  },
}

/** The quick request a mode opens; null for the other modes */
export function quickAiRequestVariantOf(
  mode: ActivationMode | null | undefined
): QuickAiRequestVariant | null {
  return (mode && VARIANTS[mode]) || null
}
