import type { ChatMessage } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { resolveEditorContext, type EditorContextInput } from './editor-context'

function input(patch: Partial<EditorContextInput> = {}): EditorContextInput {
  return {
    editorText: '',
    selectedText: '',
    messages: [],
    pendingAttachments: [],
    dismissed: null,
    ...patch,
  }
}

const sent = (attachment: string): ChatMessage[] => [
  { role: 'user', content: 'q', attachments: [attachment] },
  { role: 'assistant', content: 'a' },
]

describe('resolveEditorContext', () => {
  it('offers nothing for an empty editor', () => {
    expect(resolveEditorContext(input({ editorText: '  \n' }))).toBeNull()
  })

  it('offers the whole editor text', () => {
    expect(resolveEditorContext(input({ editorText: ' draft ' }))).toEqual({
      text: 'draft',
      source: 'editor',
      updated: false,
    })
  })

  it('prefers the selection', () => {
    expect(
      resolveEditorContext(
        input({ editorText: 'whole draft', selectedText: 'draft' })
      )
    ).toMatchObject({ text: 'draft', source: 'selection' })
  })

  it('does not offer a text the chat already got', () => {
    expect(
      resolveEditorContext(
        input({ editorText: 'draft', messages: sent('draft') })
      )
    ).toBeNull()
  })

  it('offers a changed text as an update', () => {
    expect(
      resolveEditorContext(
        input({ editorText: 'draft v2', messages: sent('draft') })
      )
    ).toMatchObject({ text: 'draft v2', updated: true })
  })

  it('does not duplicate an attachment added another way', () => {
    expect(
      resolveEditorContext(
        input({ editorText: 'draft', pendingAttachments: ['draft'] })
      )
    ).toBeNull()
  })

  it('stays removed until the text changes', () => {
    expect(
      resolveEditorContext(input({ editorText: 'draft', dismissed: 'draft' }))
    ).toBeNull()
    expect(
      resolveEditorContext(input({ editorText: 'draft 2', dismissed: 'draft' }))
    ).toMatchObject({ text: 'draft 2' })
  })
})
