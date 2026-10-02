import { visit } from 'unist-util-visit'
import type { Node } from 'unist'
import remarkStringify from 'remark-stringify'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { remarkTruncateLinks } from 'remark-truncate-links'
import remarkNormalizeHeadings from 'remark-normalize-headings'

import { MARKDOWN_STRINGIFY_OPTIONS } from '../lib/editor/markdown-options'

// Strips trailing periods and commas from text
const removeEndingPunctuation = (text: string): string => {
  return text.replace(/[.,]$/, '')
}

// AST types for markdown manipulation
type TextNode = { type: 'text'; value: string }

type EmphasisNode = { type: 'emphasis'; children: TextNode[] }

type ASTNode = TextNode | EmphasisNode

// Helper to create a text node
const createTextNode = (value: string): TextNode => ({ type: 'text', value })

// Helper to create an emphasis node
const createEmphasisNode = (value: string): EmphasisNode => ({
  type: 'emphasis',
  children: [createTextNode(value)],
})

// Processes a text node and turns bracketed text into italics
const processTextNode = (text: string): ASTNode[] => {
  const parts = text.split(/(\([^)]+\))/g)

  return parts.filter(Boolean).map((part) => {
    if (part.match(/^\([^)]+\)$/)) {
      return createEmphasisNode(part)
    }
    return createTextNode(part)
  })
}

type AstChild = Node & { value?: string; children?: AstChild[] }

// Processes child nodes of a parent element
const processChildren = (children: AstChild[]): AstChild[] => {
  const newChildren: AstChild[] = []

  children.forEach((child) => {
    if (child.type === 'text' && typeof child.value === 'string') {
      newChildren.push(...processTextNode(child.value))
    } else {
      newChildren.push(child)
    }
  })

  return newChildren
}

const removePunctuationRemarkPlugin = () => {
  return (tree: Node) => {
    // Process heading nodes
    visit(tree, 'heading', (node: AstChild) => {
      if (node.children && node.children.length > 0) {
        const lastChild = node.children[node.children.length - 1]
        if (lastChild.type === 'text' && typeof lastChild.value === 'string') {
          lastChild.value = removeEndingPunctuation(lastChild.value)
        }
      }
    })

    // Process list item nodes
    visit(tree, 'listItem', (node: AstChild) => {
      if (node.children && node.children.length > 0) {
        const paragraph = node.children[0]
        if (paragraph.type === 'paragraph' && paragraph.children) {
          const lastChild = paragraph.children[paragraph.children.length - 1]
          if (
            lastChild.type === 'text' &&
            typeof lastChild.value === 'string'
          ) {
            lastChild.value = removeEndingPunctuation(lastChild.value)
          }
        }
      }
    })
  }
}

const bracketsToItalicRemarkPlugin = () => {
  return (tree: Node) => {
    // Process paragraphs
    visit(tree, 'paragraph', (node: AstChild) => {
      if (node.children) {
        node.children = processChildren(node.children)
      }
    })

    // Process headings
    visit(tree, 'heading', (node: AstChild) => {
      if (node.children) {
        node.children = processChildren(node.children)
      }
    })

    // Process list items
    visit(tree, 'listItem', (node: AstChild) => {
      if (node.children && node.children.length > 0) {
        const paragraph = node.children[0]
        if (paragraph.type === 'paragraph' && paragraph.children) {
          paragraph.children = processChildren(paragraph.children)
        }
      }
    })
  }
}

export const useCodeFormatter = () => {
  const formatMdAndStyle = async (text: string): Promise<string> => {
    const processed = await unified()
      .use(remarkParse)
      .use(remarkTruncateLinks)
      .use(remarkNormalizeHeadings)
      .use(removePunctuationRemarkPlugin)
      .use(bracketsToItalicRemarkPlugin)
      .use(remarkStringify, MARKDOWN_STRINGIFY_OPTIONS)
      .process(text)

    return processed.toString()
  }

  const formatSomeCode = async (text: string): Promise<string> => {
    // highlight.js registers every bundled language and js-beautify is large;
    // both are only needed for this one menu action, so keep them out of the
    // startup bundle.
    const [{ default: hljs }, { default: beautify }] = await Promise.all([
      import('highlight.js'),
      import('js-beautify'),
    ])

    const result = hljs.highlightAuto(text)

    if (['css', 'scss', 'less'].includes(result.language ?? '')) {
      return beautify.css(text, { indent_size: 2 })
    } else if (['html', 'xml'].includes(result.language ?? '')) {
      return beautify.html(text, { indent_size: 2 })
    } else {
      // javascript, typescript, json and other
      return beautify.js(text, { indent_size: 2 })
    }
  }

  return { formatMdAndStyle, formatSomeCode }
}
