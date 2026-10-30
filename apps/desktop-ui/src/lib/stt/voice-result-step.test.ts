import { describe, expect, it } from 'vitest'

import { createVoiceResultStep } from './voice-result-step'

describe('createVoiceResultStep', () => {
  it('shows and resets the dictation result step', () => {
    const step = createVoiceResultStep()
    expect(step.isInsertMenuVisible.value).toBe(false)
    expect(step.dictationResultText.value).toBe('')
    expect(step.dictationOldText.value).toBe('')

    step.showResult('Dictated text', 'Original speech')
    expect(step.isInsertMenuVisible.value).toBe(true)
    expect(step.dictationResultText.value).toBe('Dictated text')
    expect(step.dictationOldText.value).toBe('Original speech')

    step.resetResult()
    expect(step.isInsertMenuVisible.value).toBe(false)
    expect(step.dictationResultText.value).toBe('')
    expect(step.dictationOldText.value).toBe('')
  })
})
