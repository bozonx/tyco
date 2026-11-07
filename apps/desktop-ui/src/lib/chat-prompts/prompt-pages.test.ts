import { describe, expect, it } from 'vitest'

import { createPromptPageNavigation } from './prompt-page-navigation'
import {
  describePromptPages,
  promptPagesOfProfile,
  promptSlots,
} from './prompt-pages'
import type { ChatPromptPageConfig } from '@tyco/shared'

const page = (
  profileId: string,
  slots: ChatPromptPageConfig['slots'] = {}
): ChatPromptPageConfig => ({
  profileId,
  items: [
    { id: 'a', name: 'Fix', rule: 'Fix it' },
    { id: 'b', name: 'Empty', rule: '  ' },
  ],
  slots,
})

const options = {
  profiles: [{ id: 'writer', name: 'Writer' }],
  defaultProfileName: 'Ask AI',
  areProfilesLoaded: true,
}

describe('describePromptPages', () => {
  it('names the profile of each page and flags a missing one', () => {
    const views = describePromptPages(
      [page(''), page('writer'), page('gone')],
      options
    )
    expect(
      views.map((view) => [view.profileName, view.isProfileMissing])
    ).toEqual([
      ['Ask AI', false],
      ['Writer', false],
      ['', true],
    ])
  })

  it('reports no missing profile before the profiles are loaded', () => {
    const [view] = describePromptPages([page('gone')], {
      ...options,
      areProfilesLoaded: false,
    })
    expect(view?.isProfileMissing).toBe(false)
  })
})

describe('promptPagesOfProfile', () => {
  it('keeps the pages of the profile, the default one for null', () => {
    const views = describePromptPages(
      [page(''), page('writer'), page('')],
      options
    )
    expect(promptPagesOfProfile(views, null).map((v) => v.index)).toEqual([
      0, 2,
    ])
    expect(promptPagesOfProfile(views, 'writer').map((v) => v.index)).toEqual([
      1,
    ])
  })
})

describe('promptSlots', () => {
  it('lays out the runnable prompts by key', () => {
    const slots = promptSlots(page('', { w: 'a', e: 'b' }))
    expect(slots).toHaveLength(15)
    expect(slots[0]).toBeNull()
    expect(slots[1]?.label).toBe('Fix')
    expect(slots[2]).toBeNull()
  })
})

describe('createPromptPageNavigation', () => {
  it('opens a page and steps on when its hotkey repeats', () => {
    const navigation = createPromptPageNavigation({ pageCount: () => 3 })
    navigation.openPage(1)
    expect(navigation.pageIndex.value).toBe(1)
    navigation.repeatOpenPage(1)
    expect(navigation.pageIndex.value).toBe(2)
    navigation.repeatOpenPage(0)
    expect(navigation.pageIndex.value).toBe(0)
    navigation.prevPage()
    expect(navigation.pageIndex.value).toBe(2)
  })
})
