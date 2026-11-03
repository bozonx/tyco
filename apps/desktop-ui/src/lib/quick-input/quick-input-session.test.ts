import { describe, expect, it } from 'vitest'

import { createQuickInputSession } from './quick-input-session'

function setup() {
  return { session: createQuickInputSession() }
}

describe('createQuickInputSession', () => {
  it('keeps the text of a recent dismissal', () => {
    const { session } = setup()

    session.markDismissed()

    expect(session.start('draft')).toBe(true)
  })

  it('keeps unfinished text without an expiry', () => {
    const { session } = setup()

    session.markDismissed()

    expect(session.start('draft')).toBe(true)
  })

  it('keeps unfinished text across repeated openings', () => {
    const { session } = setup()

    session.markDismissed()
    expect(session.start('draft')).toBe(true)
    expect(session.start('draft')).toBe(true)
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
