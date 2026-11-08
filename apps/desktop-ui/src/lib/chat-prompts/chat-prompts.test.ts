import { describe, expect, it } from 'vitest'

import {
  chatPromptLabel,
  chatPromptProfileOptions,
  chatPromptsOfProfile,
  describeChatPrompts,
  emptyChatPromptIds,
  filterChatPrompts,
  moveChatPrompt,
  newChatPrompt,
  withoutPromptActions,
  withoutChatPrompts,
  withoutPromptCustomActions,
} from './chat-prompts'
import type { ChatPromptConfig, UserConfig } from '@tyco/shared'

const prompt = (
  id: string,
  profileId = '',
  name = id,
  rule = `Rule ${id}`
): ChatPromptConfig => ({ id, name, rule, profileId })

const options = {
  profiles: [
    { id: 'writer', name: 'Writer' },
    { id: 'coder', name: 'Coder' },
  ],
  areProfilesLoaded: true,
}

describe('describeChatPrompts', () => {
  it('names the profile of each prompt and runs a missing one without it', () => {
    const views = describeChatPrompts(
      [prompt('a'), prompt('b', 'writer'), prompt('c', 'gone')],
      options
    )
    expect(
      views.map(({ label, profileName, isProfileMissing, runProfileId }) => ({
        label,
        profileName,
        isProfileMissing,
        runProfileId,
      }))
    ).toEqual([
      {
        label: 'a',
        profileName: '',
        isProfileMissing: false,
        runProfileId: null,
      },
      {
        label: 'b',
        profileName: 'Writer',
        isProfileMissing: false,
        runProfileId: 'writer',
      },
      {
        label: 'c',
        profileName: '',
        isProfileMissing: true,
        runProfileId: null,
      },
    ])
  })

  it('does not report a missing profile before the profiles load', () => {
    const [view] = describeChatPrompts([prompt('a', 'writer')], {
      profiles: [],
      areProfilesLoaded: false,
    })
    expect(view?.isProfileMissing).toBe(false)
    expect(view?.runProfileId).toBe('writer')
  })

  it('leaves out the prompts without a text', () => {
    expect(
      describeChatPrompts([prompt('a', '', 'A', '  '), prompt('b')], options)
    ).toHaveLength(1)
  })
})

describe('chatPromptLabel', () => {
  it('falls back to the first line of the text', () => {
    expect(chatPromptLabel(prompt('a', '', ' ', 'Fix it\nplease'))).toBe(
      'Fix it'
    )
  })
})

describe('chatPromptsOfProfile', () => {
  const views = describeChatPrompts(
    [
      prompt('every'),
      prompt('writer', 'writer'),
      prompt('coder', 'coder'),
      prompt('gone', 'gone'),
    ],
    options
  )
  const ids = (profileId: string | null) =>
    chatPromptsOfProfile(views, profileId).map((view) => view.prompt.id)

  it('offers the prompts of every profile and those of the chat profile', () => {
    expect(ids('writer')).toEqual(['every', 'writer', 'gone'])
    expect(ids(null)).toEqual(['every', 'gone'])
  })
})

describe('filterChatPrompts', () => {
  const views = describeChatPrompts(
    [prompt('a', '', 'Summary', 'Sum up'), prompt('b', 'writer', 'Fix')],
    options
  )

  it('matches the name, the text and the profile name', () => {
    expect(filterChatPrompts(views, 'SUM')).toHaveLength(1)
    expect(filterChatPrompts(views, 'writer')[0]?.prompt.id).toBe('b')
    expect(filterChatPrompts(views, ' ')).toHaveLength(2)
    expect(filterChatPrompts(views, 'nothing')).toEqual([])
  })
})

describe('editing', () => {
  it('numbers new prompts and moves them', () => {
    const items = [prompt('chat-prompt-1'), prompt('x')]
    expect(newChatPrompt(items, 'writer')).toEqual({
      id: 'chat-prompt-2',
      name: '',
      rule: '',
      profileId: 'writer',
    })
    expect(moveChatPrompt(items, 0, 1).map((item) => item.id)).toEqual([
      'x',
      'chat-prompt-1',
    ])
    expect(moveChatPrompt(items, 0, 5)).toEqual(items)
  })

  it('drops the actions of removed prompts', () => {
    const ids = new Set(['a'])
    expect(
      withoutPromptActions(
        {
          q: { type: 'chatPrompt', promptId: 'a' },
          w: { type: 'chatPrompt', promptId: 'b' },
          e: { type: 'standard', actionId: 'copyToClipboard' },
        },
        ids
      )
    ).toEqual({
      w: { type: 'chatPrompt', promptId: 'b' },
      e: { type: 'standard', actionId: 'copyToClipboard' },
    })
    expect(
      withoutPromptCustomActions(
        [
          {
            action: { type: 'chatPrompt', promptId: 'a' },
            takesSelection: true,
          },
          { action: null, takesSelection: false },
        ],
        ids
      )
    ).toEqual([
      { action: null, takesSelection: true },
      { action: null, takesSelection: false },
    ])
  })
})

describe('chatPromptProfileOptions', () => {
  const labels = { everyProfile: 'Every', missingProfile: 'Gone' }
  const names = (item: ChatPromptConfig, loaded = true) =>
    chatPromptProfileOptions(
      item,
      { ...options, areProfilesLoaded: loaded },
      labels
    ).map((option) => option.name)

  it('lists every profile, then the profiles', () => {
    expect(names(prompt('a', 'writer'))).toEqual(['Every', 'Writer', 'Coder'])
  })

  it('keeps a missing profile, by its id until the profiles load', () => {
    expect(names(prompt('a', 'old'))).toEqual([
      'Every',
      'Writer',
      'Coder',
      'Gone',
    ])
    expect(names(prompt('a', 'old'), false)).toEqual([
      'Every',
      'Writer',
      'Coder',
      'old',
    ])
  })
})

describe('withoutChatPrompts', () => {
  it('removes the prompts and the actions that run them', () => {
    const result = withoutChatPrompts(
      {
        chatPrompts: {
          isSentImmediately: true,
          items: [prompt('a'), prompt('b')],
        },
        actionPages: [
          { slots: { q: { type: 'chatPrompt', promptId: 'a' } } },
        ] as UserConfig['actionPages'],
        customActionSlots: [
          {
            action: { type: 'chatPrompt', promptId: 'a' },
            takesSelection: true,
          },
        ],
      },
      ['a']
    )
    expect(result.chatPrompts).toEqual({
      isSentImmediately: true,
      items: [prompt('b')],
    })
    expect(result.actionPages[0]?.slots).toEqual({})
    expect(result.customActionSlots[0]?.action).toBeNull()
  })

  it('finds the prompts left without a name and a text', () => {
    expect(
      emptyChatPromptIds([prompt('a', '', ' ', ' '), prompt('b', '', '', 'x')])
    ).toEqual(['a'])
  })
})
