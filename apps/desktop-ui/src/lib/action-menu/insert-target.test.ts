import { describe, expect, it } from 'vitest'

import { shortInsertTargetName } from './insert-target'

describe('shortInsertTargetName', () => {
  it('keeps a short name and cuts a long one with an ellipsis', () => {
    expect(shortInsertTargetName('Firefox')).toBe('Firefox')
    expect(shortInsertTargetName('Thunderbird')).toBe('Thunderbi…')
    expect(shortInsertTargetName('Libre Office', 7)).toBe('Libre…')
  })

  it('has no name for an unknown application', () => {
    expect(shortInsertTargetName(undefined)).toBeUndefined()
    expect(shortInsertTargetName(null)).toBeUndefined()
    expect(shortInsertTargetName('  ')).toBeUndefined()
  })
})
