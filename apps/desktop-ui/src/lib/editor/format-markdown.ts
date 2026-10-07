import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

import { markdownStringifyOptions } from './markdown-options'

/** Format Markdown syntax without applying editorial changes to its content. */
export function formatMarkdown(text: string, settings?: unknown): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkStringify, markdownStringifyOptions(settings))
      .processSync(text)
  )
}
