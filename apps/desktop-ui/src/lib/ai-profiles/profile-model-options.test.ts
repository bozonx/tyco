import { describe, expect, it } from 'vitest'

import type { ChatLlmOption } from '../chat/chat-llm-selection'
import {
  DEFAULT_PROFILE_MODEL_OPTION,
  profileModelName,
  profileModelOptions,
} from './profile-model-options'

const t = (key: string, params?: Record<string, string>) =>
  params ? `${key}:${JSON.stringify(params)}` : key

const model = (id: string, name: string): ChatLlmOption => ({
  id,
  name,
  providerLabel: 'Provider',
  canUseImages: false,
  canUseTools: true,
  contextWindowTokens: 8000,
})
const models = [model('fast', 'Fast'), model('smart', 'Smart')]

describe('profile model options', () => {
  it('names the default after the first usable model', () => {
    expect(profileModelOptions(models, undefined, t)).toEqual([
      {
        id: DEFAULT_PROFILE_MODEL_OPTION,
        name: 'settings.profileModelDefaultNamed:{"model":"Fast"}',
      },
      { id: 'fast', name: 'Fast', group: 'Provider' },
      { id: 'smart', name: 'Smart', group: 'Provider' },
    ])
  })

  it('keeps a plain default without usable models', () => {
    expect(profileModelOptions([], undefined, t)).toEqual([
      { id: '', name: 'settings.profileModelDefault' },
    ])
  })

  it('keeps an unavailable picked model visible', () => {
    expect(profileModelOptions(models, 'gone', t).at(-1)).toEqual({
      id: 'gone',
      name: 'gone (settings.profileModelUnavailable)',
    })
    expect(profileModelOptions(models, 'smart', t)).toHaveLength(3)
  })
})

describe('profile model name', () => {
  it('names the default, a usable and an unavailable model', () => {
    expect(profileModelName(models, undefined, t)).toBe(
      'settings.profileModelDefault'
    )
    expect(profileModelName(models, 'smart', t)).toBe('Smart')
    expect(profileModelName(models, 'gone', t)).toBe(
      'gone (settings.profileModelUnavailable)'
    )
  })
})
