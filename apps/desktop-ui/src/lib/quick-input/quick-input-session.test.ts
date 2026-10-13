import { describe, expect, it } from 'vitest'

import { DRAFT_RESTORE_MS } from './draft-restore'
import { createQuickInputSession } from './quick-input-session'

function setup() {
  let time = 1000
  const session = createQuickInputSession(() => time)
  const advance = (ms: number) => {
    time += ms
  }

  return { session, advance }
}

describe('createQuickInputSession', () => {
  it('keeps the text of a recent dismissal', () => {
    const { session, advance } = setup()

    session.markDismissed()
    advance(DRAFT_RESTORE_MS)

    expect(session.start('draft')).toBe(true)
  })

  it('clears an old dismissed text and keeps it recallable', () => {
    const { session, advance } = setup()

    session.markDismissed()
    advance(DRAFT_RESTORE_MS + 1)

    expect(session.start('draft')).toBe(false)
    expect(session.recallText).toBe('draft')
  })

  it('keeps a text only for the opening right after the dismissal', () => {
    const { session } = setup()

    session.markDismissed()
    expect(session.start('draft')).toBe(true)
    expect(session.start('draft')).toBe(false)
  })

  it('makes a cancelled text recallable in memory', () => {
    const { session } = setup()

    session.markDismissed()
    session.discard('cancelled')

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
