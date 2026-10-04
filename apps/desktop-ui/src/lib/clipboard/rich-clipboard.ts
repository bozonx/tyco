import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

import { stripMarkdown } from '../editor/strip-markdown'

/** The clipboard parts this module uses, replaced in tests */
export interface RichClipboard {
  writeText: (text: string) => Promise<void>
  write?: (items: ClipboardItem[]) => Promise<void>
}

// the text is the user's own and is never shown in the webview: unlike chat
// replies it needs no sanitizing, and links keep their addresses
const htmlProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify)

export const markdownToHtml = (markdown: string): string =>
  String(htmlProcessor.processSync(markdown))

/** Whether the text has any Markdown markup at all */
export const hasMarkup = (text: string): boolean =>
  stripMarkdown(text) !== text.trim()

/**
 * Puts a Markdown text into the clipboard twice: as HTML, which rich editors
 * and mail paste formatted, and as the Markdown source in `text/plain`, which
 * terminals and messengers take. A text without markup goes as plain text
 * only.
 */
export const writeMarkdown = async (
  markdown: string,
  clipboard: RichClipboard = navigator.clipboard
): Promise<void> => {
  if (
    !clipboard.write ||
    typeof ClipboardItem === 'undefined' ||
    !hasMarkup(markdown)
  ) {
    await clipboard.writeText(markdown)
    return
  }

  try {
    await clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
        'text/html': new Blob([markdownToHtml(markdown)], {
          type: 'text/html',
        }),
      }),
    ])
  } catch {
    // some webviews write only plain text
    await clipboard.writeText(markdown)
  }
}
