import { describe, expect, it } from 'vitest'

import { toolResultMessage } from './invocation-result'

const t = (key: string) => `<${key}>`

describe('toolResultMessage', () => {
  it('puts the detail after the translated key', () => {
    expect(
      toolResultMessage({ messageKey: 'toast.failed', message: 'boom' }, t)
    ).toBe('<toast.failed>: boom')
  })

  it('uses whichever part there is', () => {
    expect(toolResultMessage({ messageKey: 'toast.failed' }, t)).toBe(
      '<toast.failed>'
    )
    expect(toolResultMessage({ message: 'boom' }, t)).toBe('boom')
    expect(toolResultMessage({}, t)).toBe('')
  })
})
