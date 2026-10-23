import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { createTranslationActions } from './translation-actions'

function fixture() {
  const quality = {
    gate: 'off' as const,
    passed: true,
    problems: [],
    remainingProblems: [],
    repaired: false,
  }
  const translateClient = vi.fn(async () => ({
    text: 'Hola',
    provider: 'deepl',
    kind: 'machine' as const,
    quality,
  }))
  const notifyEmptyText = vi.fn()
  const notifyError = vi.fn()
  const logError = vi.fn()
  const actions = createTranslationActions({
    client: { translate: translateClient },
    getUserConfig: () => ({
      ...DEFAULT_USER_CONFIG,
      llm: {
        ...DEFAULT_USER_CONFIG.llm,
        tasks: {
          ...DEFAULT_USER_CONFIG.llm.tasks,
          translation: {
            ...DEFAULT_USER_CONFIG.llm.tasks.translation,
            rule: 'Use formal tone',
          },
        },
      },
    }),
    notifyEmptyText,
    notifyError,
    logError,
    translate: (key) => key,
  })
  return {
    translateClient,
    notifyEmptyText,
    notifyError,
    logError,
    actions,
    quality,
  }
}

describe('createTranslationActions', () => {
  it('warns and skips translation when text is empty', async () => {
    const f = fixture()
    expect(await f.actions.translateTo('es', '   ')).toBe('')
    expect(f.notifyEmptyText).toHaveBeenCalledOnce()
    expect(f.translateClient).not.toHaveBeenCalled()
  })

  it('passes configured translation rules and options to the client', async () => {
    const f = fixture()
    const onStage = vi.fn()
    const result = await f.actions.translateTo('es', 'Hello', {
      sourceLanguage: 'en',
      onStage,
    })

    expect(result).toEqual({
      text: 'Hola',
      provider: 'deepl',
      kind: 'machine',
      quality: f.quality,
    })
    expect(f.translateClient).toHaveBeenCalledWith('Hello', {
      targetLanguage: 'es',
      sourceLanguage: 'en',
      signal: undefined,
      onStage,
      rules: 'Use formal tone',
      qualityGateRules: '',
    })
  })

  it('delegates request errors to the error handler when notifyError is true', async () => {
    const f = fixture()
    f.translateClient.mockRejectedValueOnce(new Error('Network down'))

    await expect(f.actions.translateTo('es', 'Hello')).rejects.toThrow(
      'Network down'
    )
    expect(f.logError).toHaveBeenCalledOnce()
    expect(f.notifyError).toHaveBeenCalledOnce()
  })

  it('rethrows request errors when notifyError is false', async () => {
    const f = fixture()
    f.translateClient.mockRejectedValueOnce(new Error('Network down'))

    await expect(
      f.actions.translateTo('es', 'Hello', { notifyError: false })
    ).rejects.toThrow('Network down')
    expect(f.notifyError).not.toHaveBeenCalled()
  })
})
