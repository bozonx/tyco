import { createCopyText } from '../lib/clipboard/copy-text'
import { writeMarkdown } from '../lib/clipboard/rich-clipboard'
import { useHistoryStore } from '../stores/history'
import useToast from './useToast'

/** `saveOutput: false` for texts that are already in the history */
export function useCopyText(options: { saveOutput: boolean }) {
  const { toast } = useToast()
  const historyStore = useHistoryStore()

  return createCopyText({
    // the texts are Markdown: rich editors get them formatted
    writeText: (text) => writeMarkdown(text),
    showToast: (messageKey, type) => toast(messageKey, type),
    saveOutput: options.saveOutput ? historyStore.saveOutput : undefined,
  })
}
