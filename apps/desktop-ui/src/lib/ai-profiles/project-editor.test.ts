import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { AiProject } from '@tyco/shared'

import { createProjectEditor } from './project-editor'

const project: AiProject = {
  id: 'notes',
  name: 'Notes',
  description: 'Daily notes',
  isExternal: false,
  targetPath: undefined,
  createdAt: 0,
  updatedAt: 0,
}

function setup() {
  const deps = {
    saveProject: vi.fn().mockResolvedValue(undefined),
    reportError: vi.fn(),
    delayMs: 100,
  }
  return { deps, editor: createProjectEditor(deps) }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('project editor', () => {
  it('fills the fields from a project and clears them for a new one', () => {
    const { editor } = setup()
    editor.load(project)
    expect(editor.name.value).toBe('Notes')
    expect(editor.description.value).toBe('Daily notes')

    editor.load()
    expect(editor.name.value).toBe('')
    expect(editor.isValid.value).toBe(false)
  })

  it('saves the trimmed fields a moment after the last change', async () => {
    const { deps, editor } = setup()
    editor.load(project)
    editor.name.value = ' Journal '
    editor.change()
    expect(editor.saveStatus.value).toBe('saving')
    await vi.advanceTimersByTimeAsync(100)

    expect(deps.saveProject).toHaveBeenCalledOnce()
    expect(deps.saveProject).toHaveBeenCalledWith({
      name: 'Journal',
      description: 'Daily notes',
      isExternal: false,
      targetPath: undefined,
    })
    expect(editor.saveStatus.value).toBe('saved')
  })

  it('holds an external project without a folder back', async () => {
    const { deps, editor } = setup()
    editor.load(project)
    editor.isExternal.value = true
    editor.change()
    await vi.advanceTimersByTimeAsync(100)
    expect(deps.saveProject).not.toHaveBeenCalled()

    editor.targetPath.value = '/home/notes'
    editor.change()
    await vi.advanceTimersByTimeAsync(100)
    expect(deps.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ isExternal: true, targetPath: '/home/notes' })
    )
  })

  it('reports a failed save', async () => {
    const { deps, editor } = setup()
    deps.saveProject.mockRejectedValue(new Error('disk full'))
    editor.load(project)
    editor.change()
    await vi.advanceTimersByTimeAsync(100)
    await nextTick()
    expect(editor.saveStatus.value).toBe('error')
    expect(deps.reportError).toHaveBeenCalledWith('disk full')
  })
})
