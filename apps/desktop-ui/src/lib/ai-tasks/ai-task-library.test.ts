import { describe, expect, it } from 'vitest'

import {
  findAiTask,
  moveTaskSlot,
  placeNewTask,
  removeTaskAt,
  taskSlotList,
  updateAiTask,
  withoutEmptyTasks,
  type AiTaskLibrary,
} from './ai-task-library'

const library = (): AiTaskLibrary => ({
  items: [
    {
      id: 'a',
      name: 'A',
      prompt: 'x',
      allowedTools: [],
      outputAction: 'replace',
      maxSteps: 5,
    },
    {
      id: 'b',
      name: 'B',
      prompt: 'y',
      allowedTools: [],
      outputAction: 'replace',
      maxSteps: 5,
    },
  ],
  slots: { q: 'a', e: 'b' },
})

describe('AI task library', () => {
  it('lists the tasks of the menu by slot', () => {
    const slots = taskSlotList(library())
    expect(slots[0]?.id).toBe('a')
    expect(slots[1]).toBeNull()
    expect(slots[2]?.id).toBe('b')
    expect(taskSlotList(undefined).every((task) => task === null)).toBe(true)
  })

  it('leaves a slot of a missing task empty', () => {
    expect(taskSlotList({ items: [], slots: { q: 'gone' } })[0]).toBeNull()
  })

  it('adds a task into a slot and removes it with its slot', () => {
    const added = placeNewTask(library(), 1, {
      id: 'c',
      name: 'C',
      prompt: '',
      allowedTools: [],
      outputAction: 'replace',
      maxSteps: 5,
    })
    expect(added.slots).toEqual({ q: 'a', w: 'c', e: 'b' })
    expect(findAiTask(added.items, 'c')?.name).toBe('C')

    const removed = removeTaskAt(added, 0)
    expect(removed.slots).toEqual({ w: 'c', e: 'b' })
    expect(removed.items.map((task) => task.id)).toEqual(['b', 'c'])
  })

  it('moves a task between slots without touching the library', () => {
    const moved = moveTaskSlot(library(), 0, 3)
    expect(moved.slots).toEqual({ e: 'b', r: 'a' })
    expect(moved.items).toEqual(library().items)
  })

  it('updates a task by its id', () => {
    expect(updateAiTask(library(), 'b', { prompt: 'z' }).items[1]).toEqual({
      id: 'b',
      name: 'B',
      prompt: 'z',
      allowedTools: [],
      outputAction: 'replace',
      maxSteps: 5,
    })
  })

  it('drops tasks with neither a name nor a prompt', () => {
    const cleaned = withoutEmptyTasks(
      placeNewTask(library(), 1, {
        id: 'c',
        name: ' ',
        prompt: '',
        allowedTools: [],
        outputAction: 'replace',
        maxSteps: 5,
      })
    )
    expect(cleaned).toEqual(library())
  })
})
