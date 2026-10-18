import { describe, expect, it, vi } from 'vitest'
import type { DesktopCall } from '../ipc/desktop-functions'
import {
  createIpcChatSessionStorageDriver,
  isChatSessionStorageDriver,
} from './chat-session-storage'

describe('chat-session-storage', () => {
  it('detects a valid ChatSessionStorageDriver', () => {
    const driver = {
      listChats: vi.fn(),
      getChat: vi.fn(),
      saveChat: vi.fn(),
      renameChat: vi.fn(),
      deleteChat: vi.fn(),
    }
    expect(isChatSessionStorageDriver(driver)).toBe(true)
    expect(isChatSessionStorageDriver({})).toBe(false)
    expect(isChatSessionStorageDriver(null)).toBe(false)
    expect(isChatSessionStorageDriver({ callFunction: vi.fn() })).toBe(false)
  })

  it('delegates listChats, getChat, saveChat, renameChat, deleteChat to HistoryApi', async () => {
    const callFunction = vi
      .fn<DesktopCall>()
      .mockImplementation(async (name) => {
        if (name === 'listChats') return { success: true, result: [] }
        if (name === 'getChat') {
          return {
            success: true,
            result: { id: 'c1', title: 'T1', lastMessageAt: 0, messages: [] },
          }
        }
        if (name === 'saveChat') return { success: true, result: undefined }
        if (name === 'renameChat') return { success: true, result: undefined }
        if (name === 'deleteChat') return { success: true, result: undefined }
        if (name === 'searchChats') return { success: true, result: ['c1'] }
        if (name === 'clearChats') return { success: true, result: undefined }
        return { success: false, error: 'Unknown' }
      })

    const driver = createIpcChatSessionStorageDriver({
      callFunction: callFunction as DesktopCall,
    })

    expect(await driver.listChats()).toEqual([])
    expect(await driver.getChat('c1')).toEqual({
      id: 'c1',
      title: 'T1',
      lastMessageAt: 0,
      messages: [],
    })
    await expect(
      driver.saveChat({ id: 'c1', title: 'T1', lastMessageAt: 0, messages: [] })
    ).resolves.toBeUndefined()
    await expect(driver.renameChat('c1', 'New Title')).resolves.toBeUndefined()
    expect(await driver.deleteChat('c1')).toEqual({
      id: 'c1',
      title: 'T1',
      lastMessageAt: 0,
      messages: [],
    })
    expect(await driver.searchChats!('query')).toEqual(['c1'])
    await expect(driver.clearChats!()).resolves.toBeUndefined()
  })

  it('adds the profile id to every call of a profile chat', async () => {
    const callFunction = vi
      .fn<DesktopCall>()
      .mockImplementation(async (name) => {
        if (name === 'getChat') {
          return {
            success: true,
            result: {
              id: 'p1',
              title: 'Profile',
              lastMessageAt: 0,
              messages: [],
            },
          }
        }
        if (name === 'searchChats') return { success: true, result: ['p1'] }
        if (name === 'listChats') return { success: true, result: [] }
        return { success: true, result: undefined }
      })
    const driver = createIpcChatSessionStorageDriver(
      { callFunction: callFunction as DesktopCall },
      'writer'
    )
    const chat = { id: 'p1', title: 'Profile', lastMessageAt: 0, messages: [] }

    await driver.listChats()
    await driver.getChat('p1')
    await driver.saveChat(chat)
    await driver.renameChat('p1', 'Renamed')
    await driver.deleteChat('p1')
    await driver.searchChats!('word')
    await driver.clearChats!()

    expect(callFunction.mock.calls).toEqual([
      ['listChats', ['writer']],
      ['getChat', ['p1', 'writer']],
      ['saveChat', [chat, 'writer']],
      ['renameChat', ['p1', 'Renamed', 'writer']],
      ['getChat', ['p1', 'writer']],
      ['deleteChat', ['p1', 'writer']],
      ['searchChats', ['word', 'writer']],
      ['clearChats', ['writer']],
    ])
  })

  it('calls the "Ask AI" chats without a profile argument', async () => {
    const callFunction = vi
      .fn<DesktopCall>()
      .mockResolvedValue({ success: true, result: [] })
    const driver = createIpcChatSessionStorageDriver({
      callFunction: callFunction as DesktopCall,
    })

    await driver.listChats()
    await driver.renameChat('c1', 'Title')

    expect(callFunction.mock.calls).toEqual([
      ['listChats', []],
      ['renameChat', ['c1', 'Title']],
    ])
  })
})
