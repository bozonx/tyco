import { describe, expect, it } from 'vitest'

import {
  fileLocationOf,
  fileLocationsOfInput,
  fileRootPathOf,
} from './file-location'

describe('file-location', () => {
  it('finds the root folder of a path', () => {
    expect(fileRootPathOf('workspace/notes.md')).toBe('workspace')
    expect(fileRootPathOf('./projects/site/a/b.ts')).toBe('projects/site')
    expect(fileRootPathOf('attachments\\a.pdf')).toBe('attachments')
    expect(fileRootPathOf('projects')).toBeUndefined()
    expect(fileRootPathOf('notes.md')).toBeUndefined()
  })

  it('tells the place of a path', () => {
    expect(fileLocationOf('workspace')).toEqual({ kind: 'workspace' })
    expect(fileLocationOf('projects/site/a.md')).toEqual({
      kind: 'project',
      projectId: 'site',
    })
    expect(fileLocationOf('')).toBeUndefined()
  })

  it('lists the distinct places of a call', () => {
    expect(
      fileLocationsOfInput({ from: 'workspace/a', to: 'workspace/b' })
    ).toEqual([{ kind: 'workspace' }])
    expect(
      fileLocationsOfInput({ from: 'attachments/a', to: 'projects/x/a' })
    ).toEqual([{ kind: 'attachments' }, { kind: 'project', projectId: 'x' }])
    expect(fileLocationsOfInput({ path: 'nowhere' })).toEqual([])
    expect(fileLocationsOfInput(null)).toEqual([])
  })
})
