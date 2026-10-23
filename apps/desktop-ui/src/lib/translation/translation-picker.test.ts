import { describe, expect, it } from 'vitest'

import { groupLanguages, languageSearchNames } from './translation-picker'

const LABELS: Record<string, string> = {
  'de-DE': 'Немецкий',
  'en-US': 'Английский',
  'it-IT': 'Итальянский',
  'pl-PL': 'Польский',
}
const label = (id: string) => LABELS[id] ?? id
const all = ['de-DE', 'en-US', 'it-IT', 'pl-PL']

describe('groupLanguages', () => {
  it('puts the recent picks first, then the others by their labels', () => {
    expect(groupLanguages(['pl-PL'], all, label)).toEqual([
      { id: 'pl-PL', group: 'recent' },
      { id: 'en-US', group: 'all' },
      { id: 'it-IT', group: 'all' },
      { id: 'de-DE', group: 'all' },
    ])
  })

  it('leaves out the language of the other field and unknown recent ones', () => {
    expect(
      groupLanguages(['pl-PL', 'xx-XX'], all, label, 'pl-PL').map(
        ({ id }) => id
      )
    ).toEqual(['en-US', 'it-IT', 'de-DE'])
  })
})

describe('languageSearchNames', () => {
  it('has the native and the English names, each once', () => {
    expect(languageSearchNames('pl-PL')).toEqual(['Polski', 'Polish'])
    expect(languageSearchNames('en-US')).toEqual(['English (US)'])
  })
})
