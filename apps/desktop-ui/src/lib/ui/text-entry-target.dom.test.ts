import { describe, expect, it } from 'vitest'

import { isTextEntryTarget } from './text-entry-target'

function element(html: string, selector: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.querySelector(selector)!
}

describe('isTextEntryTarget', () => {
  it('finds fields that take typed text', () => {
    expect(
      isTextEntryTarget(element('<textarea></textarea>', 'textarea'))
    ).toBe(true)
    expect(isTextEntryTarget(element('<input type="text">', 'input'))).toBe(
      true
    )
    expect(
      isTextEntryTarget(
        element(
          '<div contenteditable="true"><p><span>x</span></p></div>',
          'span'
        )
      )
    ).toBe(true)
  })

  it('leaves buttons, checkboxes and plain elements to shortcuts', () => {
    expect(isTextEntryTarget(element('<button>x</button>', 'button'))).toBe(
      false
    )
    expect(isTextEntryTarget(element('<input type="checkbox">', 'input'))).toBe(
      false
    )
    expect(
      isTextEntryTarget(
        element('<div contenteditable="false"><b>x</b></div>', 'b')
      )
    ).toBe(false)
    expect(isTextEntryTarget(document.body)).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})
