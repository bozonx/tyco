import { describe, expect, it } from 'vitest'

import {
  formatFileRoots,
  formatFileToolOutput,
  formatTextPage,
  pageText,
} from './file-tool-format'

describe('file-tool-format', () => {
  it('pages a text by whole lines', () => {
    expect(pageText('a\nb\nc', 2, 1)).toEqual({
      content: 'b\n',
      startLine: 2,
      endLine: 2,
      totalLines: 3,
      nextOffset: 3,
    })
    expect(pageText('a\nbb\nc\n', 1, 10, 4)).toMatchObject({
      content: 'a\n',
      endLine: 1,
      nextOffset: 2,
    })
    expect(pageText('abcdef', 1, 10, 3).content).toBe('abc')
    expect(pageText('').totalLines).toBe(0)
    expect(() => pageText('a\n', 5)).toThrow('past the end')
  })

  it('gives a whole file as it is and notes a page', () => {
    expect(formatTextPage(pageText('a\nb\n'), 'workspace/a.md')).toBe('a\nb\n')
    expect(formatTextPage(pageText(''), 'workspace/a.md')).toBe(
      'workspace/a.md is empty.'
    )
    expect(formatTextPage(pageText('a\nb\n', 2), 'workspace/a.md')).toBe(
      'b\n\n\n[Lines 2-2 of 2 of workspace/a.md.]'
    )
  })

  it('lists, finds and confirms in plain lines', () => {
    expect(
      formatFileToolOutput({
        operation: 'listDir',
        path: 'workspace',
        entries: [
          { path: 'workspace/docs/', kind: 'dir' },
          { path: 'workspace/a.md', kind: 'file', size: 1 },
        ],
        isTruncated: true,
      })
    ).toBe(
      'workspace/docs/\nworkspace/a.md (1 byte)\n[Listing truncated: list a subfolder, or use a pattern, to see more.]'
    )
    expect(
      formatFileToolOutput({
        operation: 'listDir',
        path: 'workspace',
        entries: [],
        isTruncated: false,
      })
    ).toBe('workspace is empty.')
    expect(
      formatFileToolOutput({
        operation: 'searchFiles',
        matches: [
          { path: 'workspace/a.md', line: 3, text: 'hello' },
          { path: 'workspace/b.md' },
        ],
        isTruncated: false,
      })
    ).toBe('workspace/a.md:3: hello\nworkspace/b.md')
    expect(
      formatFileToolOutput({
        operation: 'searchFiles',
        matches: [],
        isTruncated: false,
      })
    ).toBe('No matches.')
    expect(
      formatFileToolOutput({
        operation: 'writeFile',
        path: 'workspace/a.md',
        isCreated: true,
        bytes: 12,
      })
    ).toBe('Created workspace/a.md (12 bytes).')
    expect(
      formatFileToolOutput({
        operation: 'editFile',
        path: 'workspace/a.md',
        replacementCount: 1,
      })
    ).toBe('Edited workspace/a.md: 1 replacement.')
    expect(
      formatFileToolOutput({ operation: 'deletePath', path: 'workspace/a.md' })
    ).toBe('Moved workspace/a.md to the trash.')
  })

  it('describes the roots with their permissions', () => {
    const text = formatFileRoots([
      { path: 'workspace', read: 'allow', write: 'allow' },
      { path: 'projects/site', name: 'Site', read: 'ask', write: 'deny' },
    ])
    expect(text).toContain('(in workspace/uploads/)')
    expect(text).toContain(
      '- projects/site/ — the project "Site"; reading asks the user first, changing not allowed.'
    )
  })
})
