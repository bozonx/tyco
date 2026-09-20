import { visit } from 'unist-util-visit'
import type { Node } from 'unist'
import remarkStringify from 'remark-stringify'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { remarkTruncateLinks } from 'remark-truncate-links'
import remarkNormalizeHeadings from 'remark-normalize-headings'

import { MARKDOWN_STRINGIFY_OPTIONS } from '../lib/editor/markdown-options'

// Функция для удаления точек и запятых в конце текста
const removeEndingPunctuation = (text: string): string => {
  return text.replace(/[.,]$/, '')
}

// Типы для работы с AST
type TextNode = { type: 'text'; value: string }

type EmphasisNode = { type: 'emphasis'; children: TextNode[] }

type ASTNode = TextNode | EmphasisNode

// Функция для создания текстового узла
const createTextNode = (value: string): TextNode => ({ type: 'text', value })

// Функция для создания узла курсива
const createEmphasisNode = (value: string): EmphasisNode => ({
  type: 'emphasis',
  children: [createTextNode(value)],
})

// Функция для обработки текстового узла и преобразования текста в скобках в курсив
const processTextNode = (text: string): ASTNode[] => {
  const parts = text.split(/(\([^)]+\))/g)

  return parts.filter(Boolean).map((part) => {
    if (part.match(/^\([^)]+\)$/)) {
      return createEmphasisNode(part)
    }
    return createTextNode(part)
  })
}

// Функция для обработки массива дочерних узлов
const processChildren = (children: any[]): ASTNode[] => {
  const newChildren: ASTNode[] = []

  children.forEach((child) => {
    if (child.type === 'text') {
      newChildren.push(...processTextNode(child.value))
    } else {
      newChildren.push(child)
    }
  })

  return newChildren
}

const removePunctuationRemarkPlugin = () => {
  return (tree: Node) => {
    // Обрабатываем заголовки (heading)
    visit(tree, 'heading', (node: any) => {
      if (node.children && node.children.length > 0) {
        const lastChild = node.children[node.children.length - 1]
        if (lastChild.type === 'text') {
          lastChild.value = removeEndingPunctuation(lastChild.value)
        }
      }
    })

    // Обрабатываем элементы списка (listItem)
    visit(tree, 'listItem', (node: any) => {
      if (node.children && node.children.length > 0) {
        const paragraph = node.children[0]
        if (paragraph.type === 'paragraph' && paragraph.children) {
          const lastChild = paragraph.children[paragraph.children.length - 1]
          if (lastChild.type === 'text') {
            lastChild.value = removeEndingPunctuation(lastChild.value)
          }
        }
      }
    })
  }
}

const bracketsToItalicRemarkPlugin = () => {
  return (tree: Node) => {
    // Обрабатываем параграфы
    visit(tree, 'paragraph', (node: any) => {
      if (node.children) {
        node.children = processChildren(node.children)
      }
    })

    // Обрабатываем заголовки
    visit(tree, 'heading', (node: any) => {
      if (node.children) {
        node.children = processChildren(node.children)
      }
    })

    // Обрабатываем элементы списка
    visit(tree, 'listItem', (node: any) => {
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
