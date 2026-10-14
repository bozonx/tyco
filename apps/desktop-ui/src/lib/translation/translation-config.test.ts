import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { normalizeTranslationConfig } from './translation-config'

describe('normalizeTranslationConfig', () => {
  it('adds safe defaults to missing translation configuration', () => {
    expect(normalizeTranslationConfig(undefined)).toEqual({
      ...DEFAULT_USER_CONFIG.translation,
      provider: 'llm',
      qualityGate: 'off',
      deeplEndpoint: 'free',
      glossary: [],
      correctionPrompt: '',
    })
  })

  it('keeps valid provider settings and removes malformed glossary rows', () => {
    expect(
      normalizeTranslationConfig({
        provider: 'deepl',
        qualityGate: 'always',
        deeplEndpoint: 'pro',
        correctionPrompt: 'Use informal tone.',
        glossary: [
          { term: ' TyCo ', use: 'TyCo', doNotTranslate: true },
          { term: 'workspace', use: ' рабочее пространство ' },
          { term: '' },
        ],
      })
    ).toEqual({
      ...DEFAULT_USER_CONFIG.translation,
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
      correctionPrompt: 'Use informal tone.',
    })
  })
})
