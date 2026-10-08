import {
  type MarkdownCleanSettings,
  normalizeMarkdownCleanSettings,
} from '@tyco/shared'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** The part of an mdast node the conversion reads */
interface MdNode {
  type: string
  value?: string
  alt?: string | null
  children?: MdNode[]
  ordered?: boolean | null
  start?: number | null
  checked?: boolean | null
  url?: string
}

const parser = unified().use(remarkParse).use(remarkGfm)

const HTML_TAG = /<[^>]*>/g

const inline = (nodes: MdNode[] = [], options: MarkdownCleanSettings): string =>
  nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value ?? ''
        case 'inlineCode':
          return options.keepInlineCode
            ? `\`${node.value ?? ''}\``
            : (node.value ?? '')
        case 'break':
          return '\n'
        case 'image': {
          const alt = node.alt ?? ''
          const url = node.url ?? ''
          if (options.imageFormat === 'none') {
            return ''
          }
          if (options.imageFormat === 'url') {
            return url || alt
          }
          if (options.imageFormat === 'altAndUrl') {
            if (!url || alt === url) return alt || url
            if (!alt) return url
            return `${alt} (${url})`
          }
          return alt
        }
        case 'html':
          return (node.value ?? '').replace(HTML_TAG, '')
        case 'footnoteReference':
          return ''
        case 'link': {
          const text = inline(node.children, options)
          const url = node.url ?? ''
          if (options.linkFormat === 'url') {
            return url || text
          }
          if (options.linkFormat === 'textAndUrl') {
            if (!url || text === url) return text || url
            if (!text) return url
            return `${text} (${url})`
          }
          return text || url
        }
        default:
          return inline(node.children, options)
      }
    })
    .join('')

const getIndentPrefix = (style: string): string => {
  switch (style) {
    case '2spaces':
      return '  '
    case '4spaces':
      return '    '
    case 'tab':
      return '\t'
    default:
      return ''
  }
}

const indentLines = (text: string, prefix: string): string => {
  if (!prefix) return text
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n')
}

/** Continuation lines of a list item line up under its text */
const indent = (text: string, width: number): string =>
  width > 0 ? text.replace(/\n(?=.)/g, `\n${' '.repeat(width)}`) : text

const block = (node: MdNode, options: MarkdownCleanSettings): string | null => {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return inline(node.children, options)
    case 'code': {
      const code = node.value ?? ''
      const prefix = getIndentPrefix(options.codeBlockIndent)
      return indentLines(code, prefix)
    }
    case 'html':
      return (node.value ?? '').replace(HTML_TAG, '').trim() || null
    case 'blockquote': {
      const body = blocks(node.children, options).join('\n\n')
      if (options.blockquoteIndent === 'angle') {
        return body
          .split('\n')
          .map((line) => (line.length > 0 ? `> ${line}` : '>'))
          .join('\n')
      }
      const prefix = getIndentPrefix(options.blockquoteIndent)
      return indentLines(body, prefix)
    }
    case 'list':
      return (node.children ?? [])
        .map((item, index) => {
          let bullet: string
          if (node.ordered) {
            bullet = `${(node.start ?? 1) + index}. `
          } else if (options.bullet === 'none') {
            bullet = ''
          } else {
            bullet = `${options.bullet} `
          }

          const task =
            options.keepTaskCheckboxes && item.checked === true
              ? '[x] '
              : options.keepTaskCheckboxes && item.checked === false
                ? '[ ] '
                : ''

          const body = blocks(item.children, options).join('\n')
          const prefix = bullet + task
          return prefix + indent(body, prefix.length)
        })
        .join('\n')
    case 'table':
      return (node.children ?? [])
        .map((row) =>
          (row.children ?? [])
            .map((cell) => inline(cell.children, options))
            .join('\t')
        )
        .join('\n')
    case 'thematicBreak':
      return options.keepThematicBreaks ? '---' : null
    case 'definition':
    case 'footnoteDefinition':
      return null
    default:
      return node.children ? blocks(node.children, options).join('\n\n') : null
  }
}

const blocks = (
  nodes: MdNode[] = [],
  options: MarkdownCleanSettings
): string[] =>
  nodes
    .map((node) => block(node, options))
    .filter((text): text is string => text !== null)

/**
 * Plain text of a Markdown document: emphasis, headings, links, code fences and
 * quotes lose their markup, lists keep simple `-` and `1.` bullets as plain
 * text has them too, table cells are split by tabs
 */
export function stripMarkdown(markdown: string, options?: unknown): string {
  const cleanSettings = normalizeMarkdownCleanSettings(options)
  const tree = parser.parse(markdown) as MdNode

  return blocks(tree.children, cleanSettings).join('\n\n')
}
