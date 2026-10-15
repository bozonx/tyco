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
            result: { id: 'c1', title: 'T1', lastMessageAt: '', messages: [] },
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
      lastMessageAt: '',
      messages: [],
    })
    await expect(
      driver.saveChat({
        id: 'c1',
        title: 'T1',
        lastMessageAt: '',
        messages: [],
      })
    ).resolves.toBeUndefined()
    await expect(driver.renameChat('c1', 'New Title')).resolves.toBeUndefined()
    expect(await driver.deleteChat('c1')).toEqual({
      id: 'c1',
      title: 'T1',
      lastMessageAt: '',
      messages: [],
    })
    expect(await driver.searchChats!('query')).toEqual(['c1'])
    await expect(driver.clearChats!()).resolves.toBeUndefined()
  })
})
