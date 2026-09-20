import rehypeParse from 'rehype-parse'
import rehypeRemark from 'rehype-remark'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

import { MARKDOWN_STRINGIFY_OPTIONS } from './markdown-options'

/**
 * Wrappers that office editors and browsers put around a `text/html` fragment.
 * They have no place in markdown
 */
const CLIPBOARD_NOISE = [
  /<!--\s*StartFragment\s*-->/gi,
  /<!--\s*EndFragment\s*-->/gi,
  /<\?xml[^>]*\?>/gi,
  /<!\[if[^\]]*\]>[\s\S]*?<!\[endif\]>/gi,
  /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,
  /<style[\s\S]*?<\/style>/gi,
  /<script[\s\S]*?<\/script>/gi,
]

/**
 * Minimal structural view of a hast node: only the fields the normalization
 * below touches. Avoids depending on `@types/hast` directly
 */
interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const attr = (node: HastNode, name: string): string => {
  const value = node.properties?.[name]

  return typeof value === 'string' ? value : ''
}

/**
 * Google Docs wraps every copied fragment into `<b style="font-weight:normal"
 * id="docs-internal-guid-…">`. Taken literally it makes the whole paste bold,
 * so the wrapper has to be unwrapped
 */
const isFakeBold = (node: HastNode): boolean =>
  (node.tagName === 'b' || node.tagName === 'strong') &&
  (/font-weight:\s*(normal|[1-5]00)\b/i.test(attr(node, 'style')) ||
    attr(node, 'id').startsWith('docs-internal-guid'))

/**
 * Google Docs and Word express emphasis with inline styles instead of
 * `<strong>` / `<em>`, and rehype-remark only understands the tags
 */
const EMPHASIS_BY_STYLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/font-weight:\s*(bold|bolder|[6-9]00)\b/i, 'strong'],
  [/font-style:\s*italic\b/i, 'em'],
  [/text-decoration(?:-line)?:[^;]*\bline-through\b/i, 'del'],
]

const element = (tagName: string, children: HastNode[]): HastNode => ({
  type: 'element',
  tagName,
  properties: {},
  children,
})

const normalizeNodes = (nodes: HastNode[]): HastNode[] =>
  nodes.flatMap((node): HastNode[] => {
    if (node.type !== 'element') return [node]

    // a base64 image from a web page weighs megabytes and means nothing in a
    // text buffer
    if (node.tagName === 'img' && attr(node, 'src').startsWith('data:')) {
      return []
    }

    const children = normalizeNodes(node.children ?? [])

    if (isFakeBold(node)) return children

    if (node.tagName === 'span' || node.tagName === 'font') {
      const tags = EMPHASIS_BY_STYLE.filter(([pattern]) =>
        pattern.test(attr(node, 'style'))
      ).map(([, tagName]) => tagName)

      if (tags.length > 0) {
        return [
          tags.reduce(
            (inner, tagName) => element(tagName, [inner]),
            element('span', children)
          ),
        ]
      }
    }

    return [{ ...node, children }]
  })

/** Rehype plugin: undo the inline-style formatting of office editors */
const rehypeNormalizeClipboard = () => (tree: HastNode) => {
  tree.children = normalizeNodes(tree.children ?? [])
}

const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeNormalizeClipboard)
  .use(rehypeRemark)
  // tables, strikethrough and task lists from the clipboard are GFM
  .use(remarkGfm)
  .use(remarkStringify, MARKDOWN_STRINGIFY_OPTIONS)

/**
 * Clipboard HTML -> markdown.
 *
 * Synchronous: every plugin in the chain is synchronous, and a `paste` handler
 * cannot await a promise without losing the caret position
 */
export const htmlToMarkdown = (html: string): string => {
  const cleaned = CLIPBOARD_NOISE.reduce(
    (acc, pattern) => acc.replace(pattern, ''),
    html
  )

  return String(processor.processSync(cleaned)).trim()
}
