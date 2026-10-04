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
}

const parser = unified().use(remarkParse).use(remarkGfm)

const HTML_TAG = /<[^>]*>/g

const inline = (nodes: MdNode[] = []): string =>
  nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'inlineCode':
          return node.value ?? ''
        case 'break':
          return '\n'
        case 'image':
          return node.alt ?? ''
        case 'html':
          return (node.value ?? '').replace(HTML_TAG, '')
        case 'footnoteReference':
          return ''
        default:
          return inline(node.children)
      }
    })
    .join('')

/** Continuation lines of a list item line up under its text */
const indent = (text: string, width: number): string =>
  text.replace(/\n(?=.)/g, `\n${' '.repeat(width)}`)

const block = (node: MdNode): string | null => {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return inline(node.children)
    case 'code':
      return node.value ?? ''
    case 'html':
      return (node.value ?? '').replace(HTML_TAG, '').trim() || null
    case 'blockquote':
      return blocks(node.children).join('\n\n')
    case 'list':
      return (node.children ?? [])
        .map((item, index) => {
          const bullet = node.ordered ? `${(node.start ?? 1) + index}. ` : '- '
          const task =
            item.checked === true
              ? '[x] '
              : item.checked === false
                ? '[ ] '
                : ''
          const body = blocks(item.children).join('\n')
          return bullet + task + indent(body, bullet.length)
        })
        .join('\n')
    case 'table':
      return (node.children ?? [])
        .map((row) =>
          (row.children ?? []).map((cell) => inline(cell.children)).join('\t')
        )
        .join('\n')
    case 'thematicBreak':
    case 'definition':
    case 'footnoteDefinition':
      return null
    default:
      return node.children ? blocks(node.children).join('\n\n') : null
  }
}

const blocks = (nodes: MdNode[] = []): string[] =>
  nodes.map(block).filter((text): text is string => text !== null)

/**
 * Plain text of a Markdown document: emphasis, headings, links, code fences and
 * quotes lose their markup, lists keep simple `-` and `1.` bullets as plain
 * text has them too, table cells are split by tabs
 */
export function stripMarkdown(markdown: string): string {
  const tree = parser.parse(markdown) as MdNode

  return blocks(tree.children).join('\n\n')
}
