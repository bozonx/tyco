// @ts-ignore
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

  return { toast }
}
