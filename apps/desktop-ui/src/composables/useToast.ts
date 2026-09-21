import miniToastr from 'mini-toastr'

import { translate } from '../lib/i18n'

export default function useToast() {
  const toast = (
    message: string,
    type: 'success' | 'error' | 'warn' | 'info' = 'info',
    timeout = 10000
  ) => {
    miniToastr[type](translate(message), '', timeout)
  }

  /** For text that is already final, e.g. an error message from a provider */
  const toastText = (
    text: string,
    type: 'success' | 'error' | 'warn' | 'info' = 'info',
    timeout = 10000
  ) => {
    miniToastr[type](text, '', timeout)
  }

  return { toast, toastText }
}
