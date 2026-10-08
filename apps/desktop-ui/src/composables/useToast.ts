import { translate } from '../lib/i18n'
import { type ToastType, useToastStore } from '../stores/toast'

export default function useToast() {
  const toastStore = useToastStore()

  const toast = (
    message: string,
    type: ToastType = 'info',
    paramsOrTimeout?: number | Record<string, string | number>,
    timeout?: number
  ) => {
    const params =
      typeof paramsOrTimeout === 'object' ? paramsOrTimeout : undefined
    const duration =
      typeof paramsOrTimeout === 'number' ? paramsOrTimeout : timeout
    toastStore.addToast(translate(message, params), type, { duration })
  }

  /** For text that is already final, e.g. an error message from a provider */
  const toastText = (
    text: string,
    type: ToastType = 'info',
    timeout?: number
  ) => {
    toastStore.addToast(text, type, { duration: timeout })
  }

  return { toast, toastText }
}
