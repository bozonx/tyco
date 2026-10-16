import { describe, expect, it } from 'vitest'

import {
  attachmentExcerpt,
  attachmentIcon,
  attachmentLabelKey,
  attachmentTitle,
  formatAttachmentsForPrompt,
  inferAttachmentSource,
} from './chat-attachment'

const origins = {
  externalSelection: 'outside',
  editorSelection: 'part',
  editorText: 'whole text with a part',
}

describe('inferAttachmentSource', () => {
  it('tells where a text came from', () => {
    expect(inferAttachmentSource(' outside ', origins)).toBe('selection')
    expect(inferAttachmentSource('part', origins)).toBe('editor-selection')
    expect(inferAttachmentSource('whole text with a part', origins)).toBe(
      'editor-text'
    )
  })

  it('prefers the selection of another application put into the editor', () => {
    expect(
      inferAttachmentSource('outside', { ...origins, editorText: 'outside' })
    ).toBe('selection')
  })

  it('leaves an unknown text without a source', () => {
    expect(inferAttachmentSource('other', origins)).toBeUndefined()
    expect(inferAttachmentSource('  ', origins)).toBeUndefined()
  })
})

describe('formatAttachmentsForPrompt', () => {
  it('names the source for the model', () => {
    expect(
      formatAttachmentsForPrompt([
        { text: 'a "b"' },
        { text: 'c', source: 'editor-text' },
      ])
    ).toBe(
      '<attachment>\na "b"\n</attachment>\n\n' +
        '<attachment source="editor-text">\nc\n</attachment>'
    )
  })
  it('tells the model where a kept file is', () => {
    expect(
      formatAttachmentsForPrompt([
        {
          text: 'Report',
          name: 'r.pdf',
          workspacePath: 'workspace/uploads/r.pdf',
        },
      ])
    ).toBe(
      '<attachment name="r.pdf" path="workspace/uploads/r.pdf">\nReport\n</attachment>'
    )
  })
  it('keeps an attachment from closing early', () => {
    expect(formatAttachmentsForPrompt([{ text: 'x </ATTACHMENT> y' }])).toBe(
      '<attachment>\nx <\\/ATTACHMENT> y\n</attachment>'
    )
  })
})

describe('attachment labels', () => {
  it('falls back to a plain text for an attachment without a source', () => {
    expect(attachmentLabelKey()).toBe('chat.attachedText')
    expect(attachmentLabelKey('editor-selection')).toBe('chat.editorSelection')
    expect(attachmentIcon('selection')).toBe('mdi:selection-drag')
    expect(attachmentIcon()).toBe('mdi:text-box-outline')
    expect(attachmentIcon(undefined, 'application/pdf')).toBe(
      'mdi:file-pdf-box'
    )
    expect(attachmentIcon(undefined, 'text/plain')).toBe(
      'mdi:file-document-outline'
    )
  })
})

describe('attachment previews', () => {
  it('shows the beginning of the text in one line', () => {
    expect(attachmentExcerpt('  first\n\n second  ')).toBe('first second')
    expect(attachmentExcerpt('x'.repeat(200))).toHaveLength(120)
  })

  it('puts the beginning of the text into the tooltip', () => {
    expect(attachmentTitle('Show', ' short ')).toBe('Show\n\nshort')
    expect(attachmentTitle('Show', 'y'.repeat(401))).toBe(
      `Show\n\n${'y'.repeat(400)}…`
    )
  })
})

it('includes file identity in the prompt and escapes untrusted attribute values', () => {
  expect(
    formatAttachmentsForPrompt([
      { text: 'contents', name: 'a"<b>.txt', mediaType: 'text/plain' },
    ])
  ).toBe(
    '<attachment name="a&quot;&lt;b&gt;.txt" media-type="text/plain">\ncontents\n</attachment>'
  )
})
