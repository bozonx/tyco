import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

import { readChatDocx } from './chat-docx'

const zip = (xml: string) =>
  zipSync({
    'word/document.xml': strToU8(xml),
    'word/media/ignored.png': new Uint8Array([1, 2]),
  })
const document = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

describe('DOCX text extraction', () => {
  it('extracts paragraphs, table cells, tabs and line breaks without markup', () => {
    const attachment = readChatDocx(
      zip(
        document(
          '<w:p><w:r><w:t>Hello &amp; world</w:t><w:tab/><w:t>next</w:t><w:br/><w:t>line</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
        )
      ),
      'report.docx'
    )
    expect(attachment.text).toBe('Hello & world\tnext\nline\ncell')
    expect(attachment.name).toBe('report.docx')
    expect(attachment.mediaType).toContain('wordprocessingml')
  })
  it('keeps text box paragraphs once, after their host paragraph', () => {
    const textBox =
      '<w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent>'
    const attachment = readChatDocx(
      zip(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>` +
          `<w:p><w:r><w:t>host</w:t></w:r><w:r><mc:AlternateContent><mc:Choice>${textBox}</mc:Choice><mc:Fallback>${textBox}</mc:Fallback></mc:AlternateContent></w:r></w:p>` +
          '<w:p><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>'
      ),
      'box.docx'
    )
    expect(attachment.text).toBe('host\nboxed\nafter')
  })
  it('rejects external entities, missing documents and corrupted XML', () => {
    expect(() =>
      readChatDocx(
        zip('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><x>&x;</x>'),
        'a.docx'
      )
    ).toThrow()
    expect(() => readChatDocx(zip('<broken'), 'a.docx')).toThrow()
    expect(() =>
      readChatDocx(zipSync({ unrelated: strToU8('text') }), 'a.docx')
    ).toThrow()
  })
  it('bounds decompressed XML, including compressed ZIP bombs', () => {
    expect(() =>
      readChatDocx(zip(document('a'.repeat(4 * 1024 * 1024 + 1))), 'a.docx')
    ).toThrow()
  })
})
