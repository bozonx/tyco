import { describe, expect, it } from 'vitest'
import {
  parseOpenMainChatEvent,
  type EditorTransfer,
  type DesktopInvoke,
  type Chat,
  type ChatSummary,
} from '@tyco/shared'
import type { DesktopCall } from '../ipc/ipc-model'
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

it('keeps generated command arguments and results tied to their names', () => {
  const checkTypes = (invoke: DesktopInvoke) => {
    invoke('get_chat', { id: 'chat-1' })
    // @ts-expect-error A chat id is mandatory.
    invoke('get_chat', {})
    // @ts-expect-error The wire argument is title, never description.
    invoke('rename_chat', { id: 'chat-1', description: 'Title' })
    // @ts-expect-error Window actions require an activation guard.
    invoke('paste_into_target_and_hide', { text: 'Result' })
    // @ts-expect-error Removed command names are not part of the API.
    invoke('close_window')
    // @ts-expect-error Commands keep their Rust names.
    invoke('net_fetch')
    // @ts-expect-error Binary arguments carry their metadata beside the bytes.
    invoke('store_chat_image', new Uint8Array())
    invoke('store_chat_image', {
      bytes: new Uint8Array(),
      meta: { importId: 'import-1', name: 'image.png' },
    })
    // @ts-expect-error A list summary cannot be used as a complete chat.
    const chat: Promise<Chat[]> = invoke('list_chats')
    return chat
  }
  expect(typeof checkTypes).toBe('function')
})

it('lets the IPC model add the activation of the window', () => {
  const checkTypes = (call: DesktopCall) => {
    call('paste_into_target_and_hide', { text: 'Result' })
    call('hide_window')
    // @ts-expect-error The model names the activation, never the caller.
    call('paste_into_target_and_hide', { text: 'Result', activationId: 1 })
  }
  expect(typeof checkTypes).toBe('function')
})

it('keeps the shared chat summary fixture free of full messages', () => {
  const summary = fixtures.chatSummary satisfies ChatSummary
  expect(summary.title).toBe('Chat title')
  expect(summary).not.toHaveProperty('messages')
})
