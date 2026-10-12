import type { ChatAttachment } from '@tyco/shared'
import type { InputRect } from '../../quick-panel/input-region'

export interface WindowsFunctions {
  hideWindow: { args: [] }
  dismissQuickWindow: { args: [] }
  setQuickInputRegion: { args: [region: InputRect | null] }
  openMainChat: {
    args: [attachment?: ChatAttachment, question?: string, autoSend?: boolean]
  }
  openMainEditor: { args: [text?: string, sourceText?: string] }
  activateMode: { args: [mode: string, text?: string] }
  pasteIntoTargetAndHide: { args: [text: string] }
  openInBrowser: { args: [url: string] }
  openInBrowserAndHide: { args: [url: string] }
}
