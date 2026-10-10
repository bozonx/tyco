import type { ChatMessage } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  resolveEditorContext,
  resolveVoiceChatContext,
  type EditorContextInput,
} from './editor-context'

function input(patch: Partial<EditorContextInput> = {}): EditorContextInput {
  return {
    editorText: '',
    selectedText: '',
    messages: [],
    pendingAttachments: [],
    dismissed: null,
    accepted: null,
    staleSelection: null,
    ...patch,
  }
}

const sent = (attachment: string): ChatMessage[] => [
  { role: 'user', content: 'q', attachments: [{ text: attachment }] },
  { role: 'assistant', content: 'a' },
]

describe('resolveEditorContext', () => {
  it('offers nothing for an empty editor', () => {
    expect(resolveEditorContext(input({ editorText: '  \n' }))).toBeNull()
  })

  it('only suggests the whole editor text', () => {
    expect(resolveEditorContext(input({ editorText: ' draft ' }))).toEqual({
      text: 'draft',
      source: 'editor-text',
      updated: false,
      mode: 'suggested',
    })
  })

  it('attaches a fresh selection', () => {
    expect(
      resolveEditorContext(
        input({ editorText: 'whole draft', selectedText: 'draft' })
      )
    ).toMatchObject({
      text: 'draft',
      source: 'editor-selection',
      mode: 'attached',
    })
  })

  it('only suggests a selection made before the chat came into view', () => {
    expect(
      resolveEditorContext(
        input({ selectedText: ' draft ', staleSelection: 'draft' })
      )
    ).toMatchObject({ text: 'draft', mode: 'suggested' })
    expect(
      resolveEditorContext(
        input({ selectedText: 'new part', staleSelection: 'draft' })
      )
    ).toMatchObject({ text: 'new part', mode: 'attached' })
  })

  it('attaches a suggestion the user took', () => {
    expect(
      resolveEditorContext(input({ editorText: 'draft', accepted: 'draft' }))
    ).toMatchObject({ mode: 'attached' })
    expect(
      resolveEditorContext(input({ editorText: 'draft 2', accepted: 'draft' }))
    ).toMatchObject({ mode: 'suggested' })
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
    ).toMatchObject({ text: 'draft v2', updated: true, mode: 'suggested' })
  })

  it('does not duplicate an attachment added another way', () => {
    expect(
      resolveEditorContext(
        input({
          editorText: 'draft',
          pendingAttachments: [{ text: 'draft', source: 'selection' }],
        })
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

describe('resolveVoiceChatContext', () => {
  it('prefers the text selected in another application', () => {
    expect(
      resolveVoiceChatContext({
        externalSelection: ' outside ',
        editorSelection: 'inside',
        staleSelection: null,
      })
    ).toEqual({ text: 'outside', source: 'selection' })
  })

  it('takes a fresh selection in the editor', () => {
    expect(
      resolveVoiceChatContext({
        externalSelection: null,
        editorSelection: 'inside',
        staleSelection: null,
      })
    ).toEqual({ text: 'inside', source: 'editor-selection' })
  })

  it('skips a selection left from an earlier showing of the window', () => {
    expect(
      resolveVoiceChatContext({
        externalSelection: '',
        editorSelection: 'inside',
        staleSelection: 'inside',
      })
    ).toBeNull()
  })
})
