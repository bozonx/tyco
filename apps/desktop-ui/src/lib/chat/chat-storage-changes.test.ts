import { describe, expect, it } from 'vitest'

import { changedChatFiles } from './chat-storage-changes'

describe('changedChatFiles', () => {
  const event = {
    paths: ['chats/a.json', 'config.json'],
    vaultChanges: [
      { vaultId: '', path: 'profiles/writer/chats/b.json' },
      { vaultId: 'w1', path: 'profiles/writer/chats/c.json' },
      { vaultId: 'w1', path: 'profiles/writer/profile.json' },
    ],
  }

  it('keeps the chats of each history apart', () => {
    expect(changedChatFiles(event, null)).toEqual(['a.json'])
    expect(changedChatFiles(event, 'writer')).toEqual(['b.json'])
    // a profile of one id in another vault is another profile
    expect(changedChatFiles(event, 'w1:writer')).toEqual(['c.json'])
  })
})
