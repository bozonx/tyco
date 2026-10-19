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
  it('adds the task to the library and puts it into the first free slot', () => {
    expect(
      addTaskFromPrompt(
        {
          aiTasks: [{ id: 'task-1', name: 'a', rule: 'A' }],
          aiTaskSlots: { w: 'task-1' },
        },
        'Be brief'
      )
    ).toEqual({
      aiTasks: [
        { id: 'task-1', name: 'a', rule: 'A' },
        { id: 'task-2', name: 'Be brief', rule: 'Be brief' },
      ],
      aiTaskSlots: { q: 'task-2', w: 'task-1' },
    })
  })

  it('refuses when all slots are taken', () => {
    const aiTasks = SHORTCUT_SLOT_KEYS.map((key, index) => ({
      id: `task-${index}`,
      name: key,
      rule: key,
    }))
    const aiTaskSlots = Object.fromEntries(
      SHORTCUT_SLOT_KEYS.map((key, index) => [key, `task-${index}`])
    )
    expect(addTaskFromPrompt({ aiTasks, aiTaskSlots }, 'Be brief')).toBe(null)
  })

  it('does not save the same request twice', () => {
    const library = {
      aiTasks: [{ id: 'task-1', name: 'Be brief', rule: 'Be brief' }],
      aiTaskSlots: { q: 'task-1' },
    }
    expect(addTaskFromPrompt(library, ' Be brief ')).toEqual(library)
  })
})
