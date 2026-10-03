import type { ToastType } from '../toast/toast-store'

export type CopyTextResult = 'copied' | 'empty' | 'failed'

export interface CopyTextDependencies {
  writeText: (text: string) => Promise<void>
  showToast: (messageKey: string, type: ToastType) => void
  /**
   * Records the copied text as leaving the app; omitted when copying from
   * history
   */
  saveOutput?: (text: string) => Promise<unknown>
}

/**
 * Plain copy to the clipboard: unlike the "copy and close" action, the window
 * stays open.
 */
export function createCopyText(deps: CopyTextDependencies) {
  return async (text: string): Promise<CopyTextResult> => {
    if (!text.trim()) {
      deps.showToast('toast.textNotSelected', 'error')
      return 'empty'
    }

    try {
      await deps.writeText(text)
    } catch {
      deps.showToast('editor.menu.clipboardUnavailable', 'error')
      return 'failed'
    }

    deps.showToast('toast.copied', 'success')
    await deps.saveOutput?.(text)

    return 'copied'
  }
}
