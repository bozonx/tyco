import { onBeforeUnmount } from 'vue'

import { createCopyValue } from '../lib/clipboard/copy-value'
import useToast from './use-toast'

/** Plain-text copy of a value with a short "copied" state for its button */
export function useCopyValue() {
  const { toastKey } = useToast()
  const model = createCopyValue({
    writeText: (text) => navigator.clipboard.writeText(text),
    reportFailure: () => toastKey('editor.menu.clipboardUnavailable', 'error'),
  })
  onBeforeUnmount(model.dispose)
  return model
}
