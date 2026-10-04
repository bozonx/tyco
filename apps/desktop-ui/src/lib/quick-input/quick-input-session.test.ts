import { describe, expect, it, vi } from 'vitest'

import { DRAFT_RESTORE_MS } from './draft-restore'
import { createQuickInputSession } from './quick-input-session'

function setup() {
  let time = 1000
  const drafts = {
    snapshot: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    discard: vi.fn().mockResolvedValue(undefined),
  }
  const session = createQuickInputSession(drafts, () => time)
  const advance = (ms: number) => {
    time += ms
  }

  return { session, drafts, advance }
}

describe('createQuickInputSession', () => {
  it('keeps the text of a recent dismissal', () => {
    const { session, drafts, advance } = setup()

    session.markDismissed()
    advance(DRAFT_RESTORE_MS)

    expect(session.start('draft')).toBe(true)
    expect(drafts.end).not.toHaveBeenCalled()
  })

  it('moves an old dismissed text to the history and keeps it recallable', () => {
    const { session, drafts, advance } = setup()

    session.markDismissed()
    advance(DRAFT_RESTORE_MS + 1)

    expect(session.start('draft')).toBe(false)
    expect(drafts.end).toHaveBeenCalledWith('draft')
    expect(session.recallText).toBe('draft')
  })

  it('keeps a text only for the opening right after the dismissal', () => {
    const { session } = setup()

    session.markDismissed()
    expect(session.start('draft')).toBe(true)
    expect(session.start('draft')).toBe(false)
  })

  it('makes a cancelled text recallable but drops its draft', () => {
    const { session, drafts } = setup()

    session.markDismissed()
    session.discard('cancelled')

    expect(drafts.discard).toHaveBeenCalledOnce()
    expect(session.recallText).toBe('cancelled')
    // Esc is deliberate: the next opening is empty
    expect(session.start('')).toBe(false)
  })

  it('recalls the latest of the sent and cancelled texts', () => {
    const { session } = setup()

    session.submitted('sent')
    session.discard('cancelled')
    expect(session.recallText).toBe('cancelled')

    session.submitted('sent again')
    session.discard('  ')
    expect(session.recallText).toBe('sent again')
  })
})
