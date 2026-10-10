import type { Element, Root } from 'hast'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeOptions,
} from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { SKIP, visit } from 'unist-util-visit'

export interface ChatMarkdownLabels {
  reasoning: string
  footnotes: string
  footnoteBack: string
  loadImage: string
  note: string
  tip: string
  important: string
  warning: string
  caution: string
}

const parser = unified().use(remarkParse).use(remarkGfm)

/** Normalize LLM delimiters without changing examples inside code or HTML. */
function normalizeMarkdown(markdown: string, reasoning: string): string {
  const protectedRanges: Array<[number, number]> = []
  visit(parser.parse(markdown), (node) => {
    if (['code', 'inlineCode', 'html'].includes(node.type)) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        if (
          node.type !== 'html' ||
          !/^<\/?think\s*>/i.test(markdown.slice(start, end))
        ) {
          protectedRanges.push([start, end])
        }
      }
    }
  })
  const escapedLabel = reasoning.replace(
    /[&<>"']/g,
    (character) => `&#${character.charCodeAt(0)};`
  )
  return markdown.replace(
    /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|(?<!\\)\$\$([^\n]+?)\$\$|<think\s*>|<\/think\s*>/gi,
    (
      match: string,
      inline: string | undefined,
      block: string | undefined,
      singleLineDisplay: string | undefined,
      offset: number
    ) => {
      if (
        protectedRanges.some(
          ([start, end]) => offset < end && offset + match.length > start
        )
      )
        return match
      if (inline !== undefined) return `$${inline}$`
      if (block !== undefined) return `\n\n$$\n${block.trim()}\n$$\n\n`
      if (singleLineDisplay !== undefined)
        return `\n\n$$\n${singleLineDisplay}\n$$\n\n`
      return /^<\//.test(match)
        ? '\n\n</details>\n\n'
        : `\n\n<details>\n<summary>${escapedLabel}</summary>\n\n`
    }
  )
}

export function isChatWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

function decorateMarkdown(prefix: string, labels: ChatMarkdownLabels) {
  return () => (tree: Root) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'a') {
        const href = String(node.properties.href ?? '')
        if (href.startsWith('#'))
          node.properties.href = `#${prefix}${href.slice(1)}`
        else if (!isChatWebUrl(href)) delete node.properties.href
      }
      if (node.tagName === 'img') {
        const source = String(node.properties.src ?? '')
        const alt = String(node.properties.alt ?? '')
        // The webview never requests remote images directly.
        if (isChatWebUrl(source)) {
          node.tagName = 'span'
          node.properties = { className: ['chat-image'] }
          node.children = [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['chat-image-alt'] },
              children: [{ type: 'text', value: alt }],
            },
            {
              type: 'element',
              tagName: 'img',
              properties: { alt, loading: 'lazy', hidden: true },
              children: [],
            },
            {
              type: 'element',
              tagName: 'button',
              properties: { type: 'button', dataImageUrl: source },
              children: [{ type: 'text', value: labels.loadImage }],
            },
          ]
        } else if (
          !/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(
            source
          )
        ) {
          node.tagName = 'span'
          node.properties = {}
          node.children = [{ type: 'text', value: alt }]
        }
        return SKIP
      }
      if (node.tagName !== 'blockquote') return undefined
      const first = node.children.find(
        (child): child is Element =>
          child.type === 'element' && child.tagName === 'p'
      )
      const text = first?.children[0]
      if (!first || text?.type !== 'text') return undefined
      const marker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s|$)/.exec(
        text.value
      )
      if (!marker) return undefined
      const kind = marker[1].toLowerCase() as
        'note' | 'tip' | 'important' | 'warning' | 'caution'
      text.value = text.value.slice(marker[0].length)
      node.properties.className = ['chat-alert', `chat-alert-${kind}`]
      node.children.unshift({
        type: 'element',
        tagName: 'p',
        properties: { className: ['chat-alert-title'] },
        children: [{ type: 'text', value: labels[kind] }],
      })
      return undefined
    })
  }
}

export function renderChatMarkdown(
  markdown: string,
  labels: ChatMarkdownLabels,
  scope = 'message'
): string {
  const prefix = `chat-${scope.replace(/[^a-z\d-]/gi, '')}-`
  const schema: SanitizeOptions = {
    ...defaultSchema,
    clobberPrefix: prefix,
    tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary'],
    attributes: {
      ...defaultSchema.attributes,
      a: [
        ...(defaultSchema.attributes?.a ?? []),
        'href',
        'ariaDescribedBy',
        'ariaLabel',
        'dataFootnoteRef',
        'dataFootnoteBackref',
      ],
      details: ['open'],
      code: [['className', /^language-[\w-]+$/, 'math-inline', 'math-display']],
    },
    protocols: {
      ...defaultSchema.protocols,
      href: ['http', 'https'],
      src: ['http', 'https', 'data'],
    },
  }
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, {
      allowDangerousHtml: true,
      clobberPrefix: '',
      footnoteLabel: labels.footnotes,
      footnoteBackLabel: labels.footnoteBack,
    })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeSanitize, schema)
    .use(decorateMarkdown(prefix, labels))
    // Sanitize model HTML first. Only trusted KaTeX output may add math styles.
    .use(rehypeKatex, {
      trust: false,
      strict: 'ignore',
      maxSize: 20,
      maxExpand: 1000,
    })
    .use(rehypeStringify)
  return String(
    processor.processSync(normalizeMarkdown(markdown, labels.reasoning))
  )
}
