import type { AiProject, ProjectTransferPreview } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  checkProjectTransfer,
  formatByteSize,
  isProjectEmpty,
} from './project-files'

const preview = (
  changes: Partial<ProjectTransferPreview> = {},
  files: Partial<ProjectTransferPreview['files']> = {}
): ProjectTransferPreview => ({
  files: {
    fileCount: 2,
    totalBytes: 10,
    hasGit: false,
    outsideLinks: [],
    ...files,
  },
  takenNames: [],
  isOtherDisk: false,
  sharedFolderCount: 0,
  ...changes,
})

const project = (changes: Partial<AiProject> = {}): AiProject => ({
  id: 'docs',
  name: 'Docs',
  isExternal: false,
  createdAt: 1,
  updatedAt: 1,
  ...changes,
})

describe('formatByteSize', () => {
  it('picks the unit by size', () => {
    expect(formatByteSize(512, 'en-US')).toBe('512 byte')
    expect(formatByteSize(1536, 'en-US')).toBe('1.5 kB')
    expect(formatByteSize(18 * 1024 * 1024, 'en-US')).toBe('18 MB')
  })
})

describe('checkProjectTransfer', () => {
  it('blocks on taken names and links leading out of the project', () => {
    const check = checkProjectTransfer(
      preview(
        { takenNames: ['a', 'b', 'c', 'd'] },
        { outsideLinks: ['node_modules/x'] }
      ),
      { toExternal: true, isTransferring: true }
    )
    expect(check.blockers).toEqual([
      {
        key: 'settings.projectConvertTakenNames',
        params: { names: 'a, b, c, …' },
      },
      {
        key: 'settings.projectConvertOutsideLinks',
        params: { links: 'node_modules/x' },
      },
    ])
  })

  it('warns of git going into the workspace and a copy to another disk', () => {
    const shown = preview({ isOtherDisk: true }, { hasGit: true })
    expect(
      checkProjectTransfer(shown, { toExternal: false, isTransferring: true })
        .notices
    ).toEqual([
      { key: 'settings.projectConvertHasGit' },
      { key: 'settings.projectConvertOtherDisk' },
    ])
    // git leaving the workspace is no news
    expect(
      checkProjectTransfer(shown, { toExternal: true, isTransferring: true })
        .notices
    ).toEqual([{ key: 'settings.projectConvertOtherDisk' }])
  })

  it('has nothing to say when no files move', () => {
    expect(
      checkProjectTransfer(preview({ takenNames: ['a'] }), {
        toExternal: false,
        isTransferring: false,
      })
    ).toEqual({ blockers: [], notices: [] })
  })
})

describe('isProjectEmpty', () => {
  it('needs no description, access or files', () => {
    expect(isProjectEmpty(project(), [], 0)).toBe(true)
    expect(isProjectEmpty(project(), [], 3)).toBe(false)
    expect(isProjectEmpty(project(), [], null)).toBe(false)
    expect(isProjectEmpty(project({ description: 'Notes' }), [], 0)).toBe(false)
    expect(
      isProjectEmpty(
        project(),
        [
          {
            projectPermissions: {
              docs: { read: 'allow', write: 'deny', delete: 'deny' },
            },
          },
        ],
        0
      )
    ).toBe(false)
  })

  it('takes an external project with a folder here as not empty', () => {
    expect(isProjectEmpty(project({ isExternal: true }), [], null)).toBe(true)
    expect(
      isProjectEmpty(project({ isExternal: true, targetPath: '/w' }), [], null)
    ).toBe(false)
  })
})
