import { readonly, ref } from 'vue'

import useToast from './use-toast'

/**
 * Runs an async action with a busy flag; a failure is shown as a toast.
 * Resolves to whether the action succeeded.
 */
export function useBusyAction(onError?: (error: unknown) => void) {
  const { toastError } = useToast()
  const report = onError ?? toastError
  const isBusy = ref(false)

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    isBusy.value = true
    try {
      await action()
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      isBusy.value = false
    }
  }

  return { isBusy: readonly(isBusy), run }
}
