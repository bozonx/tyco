import { translate } from '../lib/i18n/index'
import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import {
  type ToastOptions,
  type ToastType,
  createToastModel,
} from '../lib/toast/toast-model'

export type { ToastOptions, ToastType }

export const useToastStore = defineStore('toast', () => {
  const model = createToastModel()
  onScopeDispose(model.clearToasts)
  const toastKey = (
    messageKey: string,
    type: ToastType = 'info',
    paramsOrDurationMs?: number | Record<string, string | number>,
    durationMs?: number
  ): void => {
    const params =
      typeof paramsOrDurationMs === 'object' ? paramsOrDurationMs : undefined
    const resolvedDurationMs =
      typeof paramsOrDurationMs === 'number' ? paramsOrDurationMs : durationMs
    useToastStore().addToast(translate(messageKey, params), type, {
      durationMs: resolvedDurationMs,
    })
  }

  /** For text that is already final, e.g. an error message from a provider */
  const toastText = (
    text: string,
    type: ToastType = 'info',
    options: ToastOptions = {}
  ): void => {
    useToastStore().addToast(text, type, options)
  }

  return { ...model, toastKey, toastText }
})
