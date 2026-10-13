import { describe, expect, it, vi } from 'vitest'

import { DRAFT_RESTORE_MS } from './draft-restore'
import { createWriteInputModel } from './write-input-model'

function setup() {
  let now = 100
  const drafts = {
    snapshot: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
  }
  const model = createWriteInputModel({ drafts, now: () => now })
  return {
    model,
    drafts,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('writer input model', () => {
  it('keeps a recently dismissed draft, then archives an expired draft', () => {
    const { model, drafts, advance } = setup()
    model.setValue('draft')
    model.markDismissed()
    expect(model.startSession()).toBe(true)
    expect(model.value.value).toBe('draft')
    expect(drafts.end).not.toHaveBeenCalled()
    model.markDismissed()
    advance(DRAFT_RESTORE_MS + 1)
    expect(model.startSession()).toBe(false)
    expect(model.value.value).toBe('')
    expect(model.recallText.value).toBe('draft')
    expect(drafts.end).toHaveBeenCalledWith('draft')
  })

  it('archives a cleared input but removes a discarded input from history', () => {
    const { model, drafts } = setup()
    model.setValue('kept')
    model.clear()
    expect(drafts.end).toHaveBeenCalledWith('kept')
    expect(model.recallText.value).toBe('kept')
    model.setValue('cancelled')
    model.discard()
    expect(drafts.discard).toHaveBeenCalledOnce()
    expect(model.recallText.value).toBe('cancelled')
    expect(model.value.value).toBe('')
  })

  it('snapshots without clearing the draft and remembers submitted text', async () => {
    const { model, drafts } = setup()
    model.setValue('draft')
    await model.snapshotDraft()
    expect(drafts.snapshot).toHaveBeenCalledWith('draft')
    expect(model.value.value).toBe('draft')
    model.rememberSubmitted('submitted')
    expect(model.recallText.value).toBe('submitted')
    model.focus()
    model.focusAndSelectAll()
    expect(model.focusCount.value).toBe(1)
    expect(model.selectAllCount.value).toBe(1)
  })
})
