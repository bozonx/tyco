import { describe, expect, it } from 'vitest'

import {
  addTaskFromPrompt,
  newAiTaskId,
  taskNameFromPrompt,
  withAiTaskIds,
} from './custom-prompt'

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

describe('AI task ids', () => {
  it('picks the first free id', () => {
    expect(newAiTaskId([])).toBe('task-1')
    expect(newAiTaskId([{ id: 'task-1' }, null, { id: 'task-3' }])).toBe(
      'task-2'
    )
  })

  it('gives an id to the tasks that have none and keeps the others', () => {
    expect(
      withAiTaskIds([
        { name: 'a' },
        null,
        { id: 'task-1', name: 'b' },
        { id: ' ', name: 'c' },
      ])
    ).toEqual([
      { id: 'task-2', name: 'a' },
      null,
      { id: 'task-1', name: 'b' },
      { id: 'task-3', name: 'c' },
    ])
  })
})

describe('addTaskFromPrompt', () => {
  it('fills the first free slot', () => {
    expect(
      addTaskFromPrompt(
        [{ id: 'task-1', name: 'a', rule: 'A' }, null],
        'Be brief',
        15
      )
    ).toEqual([
      { id: 'task-1', name: 'a', rule: 'A' },
      { id: 'task-2', name: 'Be brief', rule: 'Be brief' },
    ])
  })

  it('appends while there are slots and refuses when all are taken', () => {
    expect(addTaskFromPrompt([], 'Be brief', 1)).toEqual([
      { id: 'task-1', name: 'Be brief', rule: 'Be brief' },
    ])
    expect(
      addTaskFromPrompt([{ id: 'task-1', name: 'a', rule: 'A' }], 'Be brief', 1)
    ).toBe(null)
  })

  it('does not save the same request twice', () => {
    const tasks = [{ id: 'task-1', name: 'Be brief', rule: 'Be brief' }]
    expect(addTaskFromPrompt(tasks, ' Be brief ', 15)).toEqual(tasks)
  })
})
