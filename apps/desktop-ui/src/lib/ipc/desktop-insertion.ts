import type { IpcResult } from '@tyco/shared'

export interface DesktopInsertionDependencies {
  pasteIntoTargetAndHide: (text: string) => Promise<IpcResult<void>>
  notifyDesktop: (summary: string, body: string) => Promise<IpcResult<void>>
  translateInsertFailed: () => string
}

export function createDesktopInsertion(deps: DesktopInsertionDependencies) {
  async function pasteIntoTargetAndHide(text: string) {
    if (!text?.trim()) return

    const result = await deps.pasteIntoTargetAndHide(text)
    if (result.success) return

    const summary = deps.translateInsertFailed()
    const body = result.error || ''
    // the window may be hidden by now, where a toast would go unseen
    void deps.notifyDesktop(summary, body)
    throw new Error(body ? `${summary}: ${body}` : summary)
  }

  return { pasteIntoTargetAndHide }
}
