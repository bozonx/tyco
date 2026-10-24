import { useI18n } from './use-i18n'
import useToast from './use-toast'

/** Shows an error with a button that retries what failed, e.g. a save */
export function useRetryToast() {
  const { t } = useI18n()
  const { toastText } = useToast()
  return (message: string, retry: () => void) =>
    toastText(message, 'error', {
      action: { label: t('common.retry'), run: retry },
    })
}
