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
          items: [
            {
              id: 'task-1',
              name: 'a',
              prompt: 'A',
              allowedTools: [],
              outputAction: 'replace',
              maxSteps: 5,
            },
          ],
          slots: { w: 'task-1' },
        },
        'Be brief'
      )
    ).toEqual({
      items: [
        {
          id: 'task-1',
          name: 'a',
          prompt: 'A',
          allowedTools: [],
          outputAction: 'replace',
          maxSteps: 5,
        },
        {
          id: 'task-2',
          name: 'Be brief',
          prompt: 'Be brief',
          allowedTools: [],
          outputAction: 'replace',
          maxSteps: 5,
        },
      ],
      slots: { q: 'task-2', w: 'task-1' },
    })
  })

  it('refuses when all slots are taken', () => {
    const aiTasks = SHORTCUT_SLOT_KEYS.map((key, index) => ({
      id: `task-${index}`,
      name: key,
      prompt: key,
      allowedTools: [],
      outputAction: 'replace' as const,
      maxSteps: 5,
    }))
    const aiTaskSlots = Object.fromEntries(
      SHORTCUT_SLOT_KEYS.map((key, index) => [key, `task-${index}`])
    )
    expect(
      addTaskFromPrompt({ items: aiTasks, slots: aiTaskSlots }, 'Be brief')
    ).toBe(null)
  })

  it('does not save the same request twice', () => {
    const library = {
      items: [
        {
          id: 'task-1',
          name: 'Be brief',
          prompt: 'Be brief',
          allowedTools: [],
          outputAction: 'replace' as const,
          maxSteps: 5,
        },
      ],
      slots: { q: 'task-1' },
    }
    expect(addTaskFromPrompt(library, ' Be brief ')).toEqual(library)
  })
})
