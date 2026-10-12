import { describe, expect, it } from 'vitest'

import { resolveVoiceChatContext } from './editor-context'

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
