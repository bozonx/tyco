import { translate } from '../lib/i18n/index'
import { type ToastType, useToastStore } from '../stores/toast'

export default function useToast() {
  const toastStore = useToastStore()

  const toastKey = (
    messageKey: string,
    type: ToastType = 'info',
    paramsOrDurationMs?: number | Record<string, string | number>,
    durationMs?: number
  ) => {
    const params =
      typeof paramsOrDurationMs === 'object' ? paramsOrDurationMs : undefined
    const resolvedDurationMs =
      typeof paramsOrDurationMs === 'number' ? paramsOrDurationMs : durationMs
    toastStore.addToast(translate(messageKey, params), type, {
      durationMs: resolvedDurationMs,
    })
  }

  /** For text that is already final, e.g. an error message from a provider */
  const toastText = (
    text: string,
    type: ToastType = 'info',
    durationMs?: number
  ) => {
    toastStore.addToast(text, type, { durationMs })
  }

  return { toastKey, toastText }
}
