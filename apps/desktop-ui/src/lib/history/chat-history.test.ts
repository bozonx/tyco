import { expect, it, vi } from 'vitest'
import type { DesktopCall } from '../ipc/desktop-functions'
import type { ChatSummary } from '@tyco/shared'
import { createChatHistoryModel } from './chat-history'

it('does not restore a removed chat from a delayed list response', async () => {
  const summary = {
    id: 'chat',
    title: 'Title',
    lastMessageAt: '2026-10-12T10:00:00.000Z',
  }
  let finish!: (value: { success: true; result: ChatSummary[] }) => void
  const callFunction = vi
    .fn<DesktopCall>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValueOnce({
      success: true,
      result: { ...summary, messages: [] },
    })
    .mockResolvedValueOnce({ success: true, result: undefined })
  const model = createChatHistoryModel({
    callFunction: callFunction as DesktopCall,
  })
  model.chatHistory.value = [summary]
  const pending = model.loadChatHistory()
  await model.deleteChat('chat')
  finish({ success: true, result: [summary] })
  await pending
  expect(model.chatHistory.value).toEqual([])
})

it('keeps a persisted chat successful when refreshing its summary list fails', async () => {
  const callFunction = vi
    .fn<DesktopCall>()
    .mockResolvedValueOnce({ success: true, result: undefined })
    .mockResolvedValueOnce({ success: false, error: 'List unavailable' })
  const model = createChatHistoryModel({
    callFunction: callFunction as DesktopCall,
  })
  await expect(
    model.saveChat({
      id: 'chat',
      title: 'Title',
      lastMessageAt: '',
      messages: [],
    })
  ).resolves.toBeUndefined()
})
