import { describe, expect, it, vi } from 'vitest'
import type { DesktopCall } from '../ipc/ipc-model'
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
      searchChats: vi.fn(),
      clearChats: vi.fn(),
    }
    expect(isChatSessionStorageDriver(driver)).toBe(true)
    expect(isChatSessionStorageDriver({})).toBe(false)
    expect(isChatSessionStorageDriver(null)).toBe(false)
    expect(isChatSessionStorageDriver({ call: vi.fn() })).toBe(false)
  })

  it('delegates listChats, getChat, saveChat, renameChat, deleteChat to HistoryApi', async () => {
    const call = vi.fn<DesktopCall>().mockImplementation(async (name) => {
      if (name === 'list_chats') return { success: true, result: [] }
      if (name === 'get_chat' || name === 'delete_chat') {
        return {
          success: true,
          result: { id: 'c1', title: 'T1', lastMessageAt: 0, messages: [] },
        }
      }
      if (name === 'save_chat') return { success: true, result: undefined }
      if (name === 'rename_chat') return { success: true, result: undefined }
      if (name === 'search_chats') return { success: true, result: ['c1'] }
      if (name === 'clear_chats') return { success: true, result: undefined }
      return { success: false, error: 'Unknown' }
    })

    const driver = createIpcChatSessionStorageDriver({
      call: call as DesktopCall,
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
    expect(await driver.searchChats('query')).toEqual(['c1'])
    await expect(driver.clearChats()).resolves.toBeUndefined()
  })

  it('adds the profile id to every call of a profile chat', async () => {
    const call = vi.fn<DesktopCall>().mockImplementation(async (name) => {
      if (name === 'get_chat') {
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
      if (name === 'search_chats') return { success: true, result: ['p1'] }
      if (name === 'list_chats') return { success: true, result: [] }
      return { success: true, result: undefined }
    })
    const driver = createIpcChatSessionStorageDriver(
      { call: call as DesktopCall },
      'writer'
    )
    const chat = { id: 'p1', title: 'Profile', lastMessageAt: 0, messages: [] }

    await driver.listChats()
    await driver.getChat('p1')
    await driver.saveChat(chat)
    await driver.renameChat('p1', 'Renamed')
    await driver.deleteChat('p1')
    await driver.searchChats('word')
    await driver.clearChats()

    expect(call.mock.calls).toEqual([
      ['list_chats', { profileId: 'writer' }],
      ['get_chat', { id: 'p1', profileId: 'writer' }],
      ['save_chat', { chat, profileId: 'writer' }],
      ['rename_chat', { id: 'p1', title: 'Renamed', profileId: 'writer' }],
      ['delete_chat', { id: 'p1', profileId: 'writer' }],
      ['search_chats', { query: 'word', profileId: 'writer' }],
      ['clear_chats', { profileId: 'writer' }],
    ])
  })

  it('calls the "Ask AI" chats without a profile argument', async () => {
    const call = vi
      .fn<DesktopCall>()
      .mockResolvedValue({ success: true, result: [] })
    const driver = createIpcChatSessionStorageDriver({
      call: call as DesktopCall,
    })

    await driver.listChats()
    await driver.renameChat('c1', 'Title')

    expect(call.mock.calls).toEqual([
      ['list_chats', undefined],
      ['rename_chat', { id: 'c1', title: 'Title' }],
    ])
  })
})
