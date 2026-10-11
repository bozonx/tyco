import { Unzip, UnzipInflate } from 'fflate'

import { ChatFileError, extractedTextAttachment } from './chat-file-input'

const MAX_XML_BYTES = 4 * 1024 * 1024
const WORD_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const COMPATIBILITY_NAMESPACE =
  'http://schemas.openxmlformats.org/markup-compatibility/2006'

/**
 * Paragraphs in document order. A paragraph nested in another one (a text box)
 * becomes its own paragraph instead of being repeated inside its host, and
 * `mc:Fallback` is skipped: it repeats its `mc:Choice` for older readers
 */
function collectParagraphs(
  element: Element,
  paragraphs: string[],
  parts?: string[]
) {
  for (const child of element.children) {
    if (
      child.namespaceURI === COMPATIBILITY_NAMESPACE &&
      child.localName === 'Fallback'
    )
      continue
    if (child.namespaceURI === WORD_NAMESPACE) {
      if (child.localName === 'p') {
        const own: string[] = []
        const index = paragraphs.push('') - 1
        collectParagraphs(child, paragraphs, own)
        paragraphs[index] = own.join('')
        continue
      }
      if (parts && child.localName === 't') {
        parts.push(child.textContent || '')
        continue
      }
      if (parts && child.localName === 'tab') parts.push('\t')
      if (parts && (child.localName === 'br' || child.localName === 'cr'))
        parts.push('\n')
    }
    collectParagraphs(child, paragraphs, parts)
  }
}

/**
 * Extract only document XML; never render HTML or follow external
 * relationships.
 */
export function readChatDocx(bytes: Uint8Array, name: string) {
  const chunks: Uint8Array[] = []
  let size = 0
  let found = false
  const unzip = new Unzip((file) => {
    if (file.name !== 'word/document.xml') return
    if (found || (file.originalSize ?? 0) > MAX_XML_BYTES)
      throw new ChatFileError('textLimit')
    found = true
    file.ondata = (error, data) => {
      if (error) throw new ChatFileError('invalid')
      size += data.length
      if (size > MAX_XML_BYTES) throw new ChatFileError('textLimit')
      chunks.push(data)
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    unzip.push(
      bytes.subarray(offset, offset + 1024),
      offset + 1024 >= bytes.length
    )
  }
  if (!found || !size) throw new ChatFileError('invalid')
  const xmlBytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    xmlBytes.set(chunk, offset)
    offset += chunk.length
  }
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ChatFileError('invalid')
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) throw new ChatFileError('invalid')
  const paragraphs: string[] = []
  collectParagraphs(document.documentElement, paragraphs)
  const text = paragraphs.join('\n')
  return extractedTextAttachment(
    text,
    name,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}
