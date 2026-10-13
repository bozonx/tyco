import { describe, expect, it } from 'vitest'

import { DRAFT_RESTORE_MS } from './draft-restore'
import { createWriteInputModel } from './write-input-model'

function setup() {
  let now = 100
  const model = createWriteInputModel({ now: () => now })
  return {
    model,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('writer input model', () => {
  it('keeps a recently dismissed draft, then clears an expired draft', () => {
    const { model, advance } = setup()
    model.setValue('draft')
    model.markDismissed()
    expect(model.startSession()).toBe(true)
    expect(model.value.value).toBe('draft')
    model.markDismissed()
    advance(DRAFT_RESTORE_MS + 1)
    expect(model.startSession()).toBe(false)
    expect(model.value.value).toBe('')
    expect(model.recallText.value).toBe('draft')
  })

  it('keeps cleared and discarded inputs recallable in memory', () => {
    const { model } = setup()
    model.setValue('kept')
    model.clear()
    expect(model.recallText.value).toBe('kept')
    model.setValue('cancelled')
    model.discard()
    expect(model.recallText.value).toBe('cancelled')
    expect(model.value.value).toBe('')
  })

  it('keeps input text and remembers submitted text', async () => {
    const { model } = setup()
    model.setValue('draft')
    expect(model.value.value).toBe('draft')
    model.rememberSubmitted('submitted')
    expect(model.recallText.value).toBe('submitted')
    model.focus()
    model.focusAndSelectAll()
    expect(model.focusCount.value).toBe(1)
    expect(model.selectAllCount.value).toBe(1)
  })
})
