import { describe, expect, it } from 'vitest'
import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

import {
  addTaskFromPrompt,
  newAiTaskId,
  taskNameFromPrompt,
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
})

describe('addTaskFromPrompt', () => {
  it('fills the first free slot', () => {
    expect(
      addTaskFromPrompt(
        { w: { id: 'task-1', name: 'a', rule: 'A' } },
        'Be brief'
      )
    ).toEqual({
      q: { id: 'task-2', name: 'Be brief', rule: 'Be brief' },
      w: { id: 'task-1', name: 'a', rule: 'A' },
    })
  })

  it('refuses when all slots are taken', () => {
    const full = Object.fromEntries(
      SHORTCUT_SLOT_KEYS.map((key, index) => [
        key,
        { id: `task-${index}`, name: key, rule: key },
      ])
    )
    expect(addTaskFromPrompt(full, 'Be brief')).toBe(null)
  })

  it('does not save the same request twice', () => {
    const tasks = { q: { id: 'task-1', name: 'Be brief', rule: 'Be brief' } }
    expect(addTaskFromPrompt(tasks, ' Be brief ')).toEqual(tasks)
  })
})
