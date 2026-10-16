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

  it('delegates profile operations with profileId parameter', async () => {
    const callFunction = vi
      .fn<DesktopCall>()
      .mockImplementation(async (name) => {
        if (name === 'listProfileChats') return { success: true, result: [] }
        if (name === 'getProfileChat') {
          return {
            success: true,
            result: {
              id: 'p1',
              title: 'Profile Chat',
              lastMessageAt: '',
              messages: [],
            },
          }
        }
        if (name === 'saveProfileChat')
          return { success: true, result: undefined }
        if (name === 'renameProfileChat')
          return { success: true, result: undefined }
        if (name === 'deleteProfileChat')
          return { success: true, result: undefined }
        if (name === 'searchProfileChats')
          return { success: true, result: ['p1'] }
        if (name === 'clearProfileChats')
          return { success: true, result: undefined }
        return { success: false, error: 'Unknown' }
      })

    const { createProfileIpcChatSessionStorageDriver } =
      await import('./chat-session-storage')
    const driver = createProfileIpcChatSessionStorageDriver(
      { callFunction: callFunction as DesktopCall },
      'writer'
    )

    expect(await driver.listChats()).toEqual([])
    expect(callFunction).toHaveBeenCalledWith('listProfileChats', ['writer'])

    expect(await driver.getChat('p1')).toEqual({
      id: 'p1',
      title: 'Profile Chat',
      lastMessageAt: '',
      messages: [],
    })
    expect(callFunction).toHaveBeenCalledWith('getProfileChat', [
      'writer',
      'p1',
    ])

    expect(await driver.searchChats!('word')).toEqual(['p1'])
    expect(callFunction).toHaveBeenCalledWith('searchProfileChats', [
      'writer',
      'word',
    ])

    await driver.clearChats!()
    expect(callFunction).toHaveBeenCalledWith('clearProfileChats', ['writer'])
  })
})
