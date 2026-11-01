import { describe, expect, it } from 'vitest'
import type { EditorHistoryConfig } from '@tyco/shared'

import { createEditorHistorySettingsModel } from './editor-history-settings-model'

function setup() {
  const history: EditorHistoryConfig = {
    storage: 'disk',
    maxItems: 100,
    isSecretSanitizingEnabled: true,
    isLocalOnly: false,
  }
  const model = createEditorHistorySettingsModel({
    getHistory: () => history,
    limitMessage: (count) => `Keep ${count}`,
    sessionMessage: () => 'Remove disk history',
    retentionMessage: (days) => `Keep ${days} days`,
  })
  return { history, model }
}

describe('editor history settings', () => {
  it('waits for leaving the number field and confirmation before lowering the limit', () => {
    const { history, model } = setup()
    model.setLimit('5')
    model.setLimit('50')
    expect(history.maxItems).toBe(100)
    expect(model.pendingChange.value).toBeNull()
    model.confirmLowerLimit()
    expect(model.pendingChange.value?.message).toBe('Keep 50')
    model.confirmChange()
    expect(history.maxItems).toBe(50)
    expect(model.typedLimit.value).toBeNull()
  })

  it('restores the stored limit on cancellation and rejects invalid input', () => {
    const { history, model } = setup()
    model.setLimit('50')
    model.confirmLowerLimit()
    model.cancelChange()
    expect(history.maxItems).toBe(100)
    expect(model.typedLimit.value).toBeNull()
    model.setLimit('')
    model.confirmLowerLimit()
    expect(model.isLimitInvalid.value).toBe(true)
    expect(model.pendingChange.value).toBeNull()
  })

  it('increases limits immediately and confirms switching to session storage', () => {
    const { history, model } = setup()
    model.setLimit('200')
    expect(history.maxItems).toBe(200)
    model.setStorage('session')
    expect(history.storage).toBe('disk')
    model.confirmChange()
    expect(history.storage).toBe('session')
    model.setStorage('off')
    expect(history.storage).toBe('off')
  })
})
