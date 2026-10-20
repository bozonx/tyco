import { expect, it, vi } from 'vitest'
import type { DesktopCall } from '../ipc/ipc-model'
import type { ChatSummary } from '@tyco/shared'
import { createChatHistoryModel } from './chat-history'

it('does not restore a removed chat from a delayed list response', async () => {
  const summary = {
    id: 'chat',
    title: 'Title',
    lastMessageAt: 1_791_799_200_000,
  }
  let finish!: (value: { success: true; result: ChatSummary[] }) => void
  const call = vi
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
  const model = createChatHistoryModel({ call: call as DesktopCall }, vi.fn())
  model.chatHistory.value = [summary]
  const pending = model.loadChatHistory()
  await model.deleteChat('chat')
  finish({ success: true, result: [summary] })
  await pending
  expect(model.chatHistory.value).toEqual([])
})

it('keeps a persisted chat successful when refreshing its summary list fails', async () => {
  const call = vi
    .fn<DesktopCall>()
    .mockResolvedValueOnce({ success: true, result: undefined })
    .mockResolvedValueOnce({ success: false, error: 'List unavailable' })
  const reportError = vi.fn()
  const model = createChatHistoryModel(
    { call: call as DesktopCall },
    reportError
  )
  await expect(
    model.saveChat({
      id: 'chat',
      title: 'Title',
      lastMessageAt: 0,
      messages: [],
    })
  ).resolves.toBeUndefined()
  expect(reportError).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'List unavailable' })
  )
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
  const model = createChatHistoryModel(driver, vi.fn())
  await model.loadChatHistory()
  expect(model.chatHistory.value).toEqual([{ id: 'c1', title: 'Custom' }])

  const chat = await model.loadChat('c1')
  expect(chat?.id).toBe('c1')

  await model.deleteChat('c1')
  expect(driver.deleteChat).toHaveBeenCalledWith('c1')
  expect(model.chatHistory.value).toEqual([])
})
