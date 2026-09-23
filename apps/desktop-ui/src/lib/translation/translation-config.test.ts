import { describe, expect, it } from 'vitest'

import { normalizeTranslationConfig } from './translation-config'

describe('normalizeTranslationConfig', () => {
  it('adds safe defaults to legacy user configuration', () => {
    expect(normalizeTranslationConfig(undefined)).toEqual({
      provider: 'llm',
      qualityGate: 'on_problems',
      deeplEndpoint: 'free',
      glossary: [],
    })
  })

  it('keeps valid provider settings and removes malformed glossary rows', () => {
    expect(
      normalizeTranslationConfig({
        provider: 'deepl',
        qualityGate: 'always',
        deeplEndpoint: 'pro',
        glossary: [
          { term: ' TyCo ', use: 'TyCo', doNotTranslate: true },
          { term: 'workspace', use: ' рабочее пространство ' },
          { term: '' },
        ],
      })
    ).toEqual({
      provider: 'deepl',
      qualityGate: 'always',
      deeplEndpoint: 'pro',
      glossary: [
        { term: 'TyCo', use: 'TyCo', doNotTranslate: true },
        {
          term: 'workspace',
          use: 'рабочее пространство',
          doNotTranslate: false,
        },
      ],
    })
  })
})
