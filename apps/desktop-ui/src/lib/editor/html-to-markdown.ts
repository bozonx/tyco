import rehypeParse from 'rehype-parse'
import rehypeRemark from 'rehype-remark'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

import { MARKDOWN_STRINGIFY_OPTIONS } from './markdown-options'

/**
 * Обёртки, которыми офисные редакторы и браузеры оборачивают фрагмент в
 * `text/html`. В Markdown им делать нечего
 */
const CLIPBOARD_NOISE = [
  /<!--\s*StartFragment\s*-->/gi,
  /<!--\s*EndFragment\s*-->/gi,
  /<\?xml[^>]*\?>/gi,
  /<!\[if[^\]]*\]>[\s\S]*?<!\[endif\]>/gi,
  /<meta[^>]*>/gi,
  /<style[\s\S]*?<\/style>/gi,
  /<script[\s\S]*?<\/script>/gi,
]

const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeRemark)
  // таблицы, зачёркивание и списки задач из буфера обмена — это GFM
  .use(remarkGfm)
  .use(remarkStringify, MARKDOWN_STRINGIFY_OPTIONS)

/**
 * HTML из буфера обмена → Markdown.
 *
 * Синхронная: все плагины цепочки синхронные, а обработчик `paste` не может
 * ждать промис, не потеряв позицию каретки
 */
export const htmlToMarkdown = (html: string): string => {
  const cleaned = CLIPBOARD_NOISE.reduce(
    (acc, pattern) => acc.replace(pattern, ''),
    html
  )

  return String(processor.processSync(cleaned)).trim()
}
