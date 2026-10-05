import { describe, expect, it } from 'vitest'

import { groupLanguages, languageSearchNames } from './translate-picker'

const LABELS: Record<string, string> = {
  de_DE: 'Немецкий',
  en_US: 'Английский',
  it_IT: 'Итальянский',
  pl_PL: 'Польский',
}
const label = (id: string) => LABELS[id] ?? id
const all = ['de_DE', 'en_US', 'it_IT', 'pl_PL']

describe('groupLanguages', () => {
  it('puts the recent picks first, then the others by their labels', () => {
    expect(groupLanguages(['pl_PL'], all, label)).toEqual([
      { id: 'pl_PL', group: 'recent' },
      { id: 'en_US', group: 'all' },
      { id: 'it_IT', group: 'all' },
      { id: 'de_DE', group: 'all' },
    ])
  })

  it('leaves out the language of the other field and unknown recent ones', () => {
    expect(
      groupLanguages(['pl_PL', 'xx_XX'], all, label, 'pl_PL').map(
        ({ id }) => id
      )
    ).toEqual(['en_US', 'it_IT', 'de_DE'])
  })
})

describe('languageSearchNames', () => {
  it('has the native and the English names, each once', () => {
    expect(languageSearchNames('pl_PL')).toEqual(['Polski', 'Polish'])
    expect(languageSearchNames('en_US')).toEqual(['English (US)'])
  })
})
