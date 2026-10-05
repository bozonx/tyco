import { describe, expect, it } from 'vitest'

import { AUTO_LANGUAGE_VALUE } from '../locale/language'
import {
  canSwapLanguages,
  defaultTargetLanguage,
  groupLanguages,
} from './translate-picker'

const sources = {
  recent: ['it_IT', 'de_DE'],
  configured: ['de_DE', null, 'pl_PL'],
  all: ['de_DE', 'en_US', 'it_IT', 'pl_PL', 'ru_RU'],
}

describe('groupLanguages', () => {
  it('lists each language once, in the first group that has it', () => {
    expect(groupLanguages(sources)).toEqual([
      { id: 'it_IT', group: 'recent' },
      { id: 'de_DE', group: 'recent' },
      { id: 'pl_PL', group: 'mine' },
      { id: 'en_US', group: 'all' },
      { id: 'ru_RU', group: 'all' },
    ])
  })

  it('leaves out the language of the other field', () => {
    expect(groupLanguages(sources, 'de_DE').map(({ id }) => id)).toEqual([
      'it_IT',
      'pl_PL',
      'en_US',
      'ru_RU',
    ])
  })
})

describe('defaultTargetLanguage', () => {
  it('takes the last pick, else the first configured language', () => {
    expect(defaultTargetLanguage(sources, AUTO_LANGUAGE_VALUE)).toBe('it_IT')
    expect(
      defaultTargetLanguage(
        { recent: [], configured: [null, 'pl_PL'] },
        'en_US'
      )
    ).toBe('pl_PL')
  })

  it('skips the source language', () => {
    expect(defaultTargetLanguage(sources, 'it_IT')).toBe('de_DE')
  })

  it('is none without recent and configured languages', () => {
    expect(
      defaultTargetLanguage({ recent: [], configured: [null] }, 'en_US')
    ).toBeUndefined()
  })
})

describe('canSwapLanguages', () => {
  it('needs both languages, auto-detect being none of them', () => {
    expect(canSwapLanguages('pl_PL', 'en_US')).toBe(true)
    expect(canSwapLanguages(AUTO_LANGUAGE_VALUE, 'en_US')).toBe(false)
    expect(canSwapLanguages('pl_PL', undefined)).toBe(false)
    expect(canSwapLanguages('pl_PL', 'pl_PL')).toBe(false)
  })
})
