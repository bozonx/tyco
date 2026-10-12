import { describe, expect, it } from 'vitest'
import { parseOpenMainChatEvent, type EditorTransfer } from '@tyco/shared'
import fixtures from '../../../../../packages/shared/fixtures/desktop-events.json'

const editor = fixtures.editorTransfer satisfies EditorTransfer

describe('desktop wire contracts', () => {
  it('accepts the fixture also checked by Rust serialization', () => {
    const event = parseOpenMainChatEvent(fixtures.openMainChat)
    expect(event.attachment?.text).toBe('Captured text')
    expect(event.autoSend).toBe(true)
    expect(editor.sourceText).toBe('Original text')
  })
  it('rejects legacy and malformed event payloads', () => {
    for (const payload of [
      { text: 'Wrong field' },
      { autoSend: 'yes' },
      { attachment: { text: 1 } },
      { attachment: { text: 'x', source: 'unknown' } },
    ])
      expect(() => parseOpenMainChatEvent(payload)).toThrow()
  })
})
