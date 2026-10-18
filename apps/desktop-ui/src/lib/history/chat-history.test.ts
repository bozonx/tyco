import { expect, it, vi } from 'vitest'
import type { DesktopCall } from '../ipc/desktop-functions'
import type { ChatSummary } from '@tyco/shared'
import { createChatHistoryModel } from './chat-history'

it('does not restore a removed chat from a delayed list response', async () => {
  const summary = {
    id: 'chat',
    title: 'Title',
    lastMessageAt: 1_791_799_200_000,
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
      lastMessageAt: 0,
      messages: [],
    })
  ).resolves.toBeUndefined()
})

it('uses a custom ChatSessionStorageDriver directly', async () => {
  const driver = {
    listChats: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Custom' }]),
    getChat: vi
      .fn()
      .mockResolvedValue({ id: 'c1', title: 'Custom', messages: [] }),
    saveChat: vi.fn().mockResolvedValue(undefined),
    renameChat: vi.fn().mockResolvedValue(undefined),
    deleteChat: vi
      .fn()
      .mockResolvedValue({ id: 'c1', title: 'Custom', messages: [] }),
  }
  const model = createChatHistoryModel(driver)
  await model.loadChatHistory()
  expect(model.chatHistory.value).toEqual([{ id: 'c1', title: 'Custom' }])

  const chat = await model.loadChat('c1')
  expect(chat?.id).toBe('c1')

  await model.deleteChat('c1')
  expect(driver.deleteChat).toHaveBeenCalledWith('c1')
  expect(model.chatHistory.value).toEqual([])
})
