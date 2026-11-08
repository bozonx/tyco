import { piniaSymbol } from 'pinia'
import { hasInjectionContext, inject } from 'vue'

import { useToastStore } from '../stores/toast'

export default function useToast() {
  const hasPinia = hasInjectionContext()
    ? inject(piniaSymbol, null) !== null
    : false
  if (!hasPinia) {
    return {
      toastKey: () => undefined,
      toastText: () => undefined,
      toastError: () => undefined,
    }
  }
  const { toastKey, toastText, toastError } = useToastStore()
  return { toastKey, toastText, toastError }
}
