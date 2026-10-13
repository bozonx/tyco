import { describe, expect, it } from 'vitest'

import { translationMetaOf } from './translation-meta'

describe('translationMetaOf', () => {
  it('reads the facts of a translation', () => {
    const quality = {
      gate: 'off',
      repaired: false,
      problems: [],
      remainingProblems: [],
    }
    expect(
      translationMetaOf({
        provider: 'deepl',
        kind: 'machine',
        quality,
        extra: 1,
      })
    ).toEqual({ provider: 'deepl', kind: 'machine', model: undefined, quality })
  })

  it.each([
    {},
    { gate: 'off', repaired: false, problems: [] },
    { gate: 'invalid', repaired: false, problems: [], remainingProblems: [] },
    { gate: 'off', repaired: 'false', problems: [], remainingProblems: [] },
    { gate: 'off', repaired: false, problems: [null], remainingProblems: [] },
    {
      gate: 'off',
      repaired: false,
      problems: [{ code: 'invalid' }],
      remainingProblems: [],
    },
    {
      gate: 'off',
      repaired: false,
      problems: [],
      remainingProblems: [{ code: 'glossary', detail: 1 }],
    },
    {
      gate: 'off',
      repaired: false,
      repairFailed: 'false',
      problems: [],
      remainingProblems: [],
    },
  ])('rejects incomplete or malformed quality reports: %j', (quality) => {
    expect(
      translationMetaOf({ provider: 'deepl', kind: 'machine', quality })
    ).toBeUndefined()
  })

  it('accepts complete reports with problem details and failed repairs', () => {
    const quality = {
      gate: 'always',
      repaired: false,
      repairFailed: true,
      problems: [{ code: 'glossary', detail: 'term' }],
      remainingProblems: [{ code: 'glossary' }],
    }
    expect(
      translationMetaOf({
        provider: 'llm',
        kind: 'llm',
        model: 'local',
        quality,
      })?.quality
    ).toEqual(quality)
  })

  it('ignores meta that is not of a translation', () => {
    expect(translationMetaOf(undefined)).toBeUndefined()
    expect(translationMetaOf({ provider: 'x', kind: 'other' })).toBeUndefined()
    expect(translationMetaOf({ provider: 'x', kind: 'llm' })).toBeUndefined()
  })
})
