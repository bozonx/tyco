import { onBeforeUnmount } from 'vue'

import type { CloseWindowInterceptor } from '../lib/app/close-window'
import { useCloseWindowStore } from '../stores/close-window'

/** Lets a mounted surface close in its own way on Ctrl+Q */
export function useCloseWindowInterceptor(interceptor: CloseWindowInterceptor) {
  onBeforeUnmount(useCloseWindowStore().intercept(interceptor))
}
