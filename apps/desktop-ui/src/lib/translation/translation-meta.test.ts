import { describe, expect, it } from 'vitest'

import { translationMetaOf } from './translation-meta'

describe('translationMetaOf', () => {
  it('reads the facts of a translation', () => {
    const quality = { status: 'ok' }
    expect(
      translationMetaOf({
        provider: 'deepl',
        kind: 'machine',
        quality,
        extra: 1,
      })
    ).toEqual({ provider: 'deepl', kind: 'machine', model: undefined, quality })
  })

  it('ignores meta that is not of a translation', () => {
    expect(translationMetaOf(undefined)).toBeUndefined()
    expect(translationMetaOf({ provider: 'x', kind: 'other' })).toBeUndefined()
    expect(translationMetaOf({ provider: 'x', kind: 'llm' })).toBeUndefined()
  })
})
