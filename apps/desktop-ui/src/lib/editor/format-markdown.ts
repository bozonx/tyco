import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import type { Node } from 'unist'
import { visit } from 'unist-util-visit'

import { markdownStringifyOptions } from './markdown-options'

// Runs of spaces and tabs render as a single space anyway. Non-breaking
// spaces are left alone because they are always intentional.
const WHITESPACE_RUN = /[ \t]{2,}|\t/g

/** Collapse whitespace runs in prose; code, inline code and HTML keep theirs. */
function collapseTextWhitespace() {
  return (tree: Node) => {
    visit(tree, 'text', (node: Node & { value: string }) => {
      node.value = node.value.replace(WHITESPACE_RUN, ' ')
    })
  }
}

/** Format Markdown syntax without applying editorial changes to its content. */
export function formatMarkdown(text: string, settings?: unknown): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(collapseTextWhitespace)
      .use(remarkStringify, markdownStringifyOptions(settings))
      .processSync(text)
  )
}
