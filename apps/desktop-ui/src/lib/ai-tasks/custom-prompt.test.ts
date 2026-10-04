import { describe, expect, it } from 'vitest'

import { addTaskFromPrompt, taskNameFromPrompt } from './custom-prompt'

describe('taskNameFromPrompt', () => {
  it('takes the first line and cuts a long one', () => {
    expect(taskNameFromPrompt('  Shorter\nand simpler')).toBe('Shorter')
    const name = taskNameFromPrompt(
      'Rewrite this text in a very formal business tone'
    )
    expect(name.length).toBeLessThanOrEqual(32)
    expect(name.endsWith('…')).toBe(true)
  })
})

describe('addTaskFromPrompt', () => {
  it('fills the first free slot', () => {
    expect(
      addTaskFromPrompt([{ name: 'a', rule: 'A' }, null], 'Be brief', 15)
    ).toEqual([
      { name: 'a', rule: 'A' },
      { name: 'Be brief', rule: 'Be brief' },
    ])
  })

  it('appends while there are slots and refuses when all are taken', () => {
    expect(addTaskFromPrompt([], 'Be brief', 1)).toEqual([
      { name: 'Be brief', rule: 'Be brief' },
    ])
    expect(addTaskFromPrompt([{ name: 'a', rule: 'A' }], 'Be brief', 1)).toBe(
      null
    )
  })

  it('does not save the same request twice', () => {
    const tasks = [{ name: 'Be brief', rule: 'Be brief' }]
    expect(addTaskFromPrompt(tasks, ' Be brief ', 15)).toEqual(tasks)
  })
})
