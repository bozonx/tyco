import { Unzip, UnzipInflate } from 'fflate'

import { ChatFileError, extractedTextAttachment } from './chat-file-input'

const MAX_XML_BYTES = 4 * 1024 * 1024
const WORD_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

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
  const paragraphs = Array.from(
    document.getElementsByTagNameNS(WORD_NAMESPACE, 'p')
  )
  const text = paragraphs
    .map((paragraph) => {
      const parts: string[] = []
      for (const element of paragraph.getElementsByTagName('*')) {
        if (element.namespaceURI !== WORD_NAMESPACE) continue
        if (element.localName === 't') parts.push(element.textContent || '')
        else if (element.localName === 'tab') parts.push('\t')
        else if (element.localName === 'br' || element.localName === 'cr')
          parts.push('\n')
      }
      return parts.join('')
    })
    .join('\n')
  return extractedTextAttachment(
    text,
    name,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}
