import type { AiFileRoot, ProfileToolSettings } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { createChatToolPolicy } from './chat-tool-policy'
import {
  createChatToolRegistry,
  type ChatToolContext,
  type ChatToolDefinition,
} from './chat-tool-registry'
import {
  createFileToolProvider,
  fileRootOf,
  stricterAccess,
  type FileToolsDependencies,
} from './file-tools'

const roots: AiFileRoot[] = [
  { path: 'workspace', read: 'allow', write: 'allow' },
  {
    path: 'projects/book',
    name: 'Book',
    description: 'The novel',
    read: 'allow',
    write: 'ask',
  },
  { path: 'projects/notes', name: 'Notes', read: 'ask', write: 'deny' },
]

const settings = (
  access: 'allow' | 'ask' = 'allow',
  isEnabled = true
): ProfileToolSettings => ({ groups: { files: { isEnabled, access } } })

function setup(overrides: Partial<FileToolsDependencies> = {}) {
  const deps = {
    listRoots: vi.fn<FileToolsDependencies['listRoots']>(async () => roots),
    run: vi.fn<FileToolsDependencies['run']>(),
    preview: vi.fn<FileToolsDependencies['preview']>(),
    readDocumentText: vi.fn<FileToolsDependencies['readDocumentText']>(
      async () => 'page one\npage two\n'
    ),
    warn: vi.fn(),
  }
  Object.assign(deps, overrides)
  return { deps, provider: createFileToolProvider(deps) }
}

const context = (
  toolSettings: ProfileToolSettings | undefined = settings(),
  profileId: string | null = 'writer'
): ChatToolContext => ({ profileId, modelId: 'model', settings: toolSettings })

async function toolsOf(
  provider: ReturnType<typeof setup>['provider'],
  ctx = context()
) {
  const tools = await provider.tools(ctx)
  return new Map(tools.map((tool) => [tool.name, tool]))
}

const execute = (tool: ChatToolDefinition | undefined, input: unknown) =>
  tool!.execute(input, {
    signal: new AbortController().signal,
    toolCallId: 'c1',
    outputLimitCharacters: 20_000,
  })

describe('file-tools', () => {
  it('finds the root of a path and the stricter of two modes', () => {
    expect(fileRootOf(roots, 'projects/book/ch1.md')?.path).toBe(
      'projects/book'
    )
    expect(fileRootOf(roots, './workspace\\a.md')?.path).toBe('workspace')
    expect(fileRootOf(roots, 'projects/other/a.md')).toBeUndefined()
    expect(fileRootOf(roots, 'elsewhere')).toBeUndefined()
    expect(stricterAccess('allow', 'ask')).toBe('ask')
    expect(stricterAccess('ask', 'deny', 'allow')).toBe('deny')
    expect(stricterAccess()).toBe('allow')
  })

  it('offers nothing to "Ask AI" or a profile with the group off', async () => {
    const { provider, deps } = setup()
    expect(await provider.tools(context(settings(), null))).toEqual([])
    expect(await provider.tools(context(settings('allow', false)))).toEqual([])
    expect(await provider.tools(context({ groups: {} }))).toEqual([])
    expect(deps.listRoots).not.toHaveBeenCalled()
  })

  it('offers nothing when the roots cannot be read', async () => {
    const { provider, deps } = setup({
      listRoots: vi.fn(async () => {
        throw new Error('The file tools are off')
      }),
    })
    expect(await provider.tools(context())).toEqual([])
    expect(deps.warn).toHaveBeenCalledOnce()
  })

  it('decides each call by its root and the group', async () => {
    const { provider } = setup()
    const tools = await toolsOf(provider)
    const access = (name: string, input: unknown) =>
      tools.get(name)!.accessFor!(input)

    expect(access('read_file', { path: 'workspace/a.md' })).toBe('allow')
    expect(access('write_file', { path: 'projects/book/a.md' })).toBe('ask')
    expect(access('write_file', { path: 'projects/notes/a.md' })).toBe('deny')
    expect(access('read_file', { path: 'projects/notes/a.md' })).toBe('ask')
    // a search of everything reads every root
    expect(access('search_files', { query: 'x' })).toBe('ask')
    expect(access('list_files', {})).toBe('ask')
    expect(
      access('move_path', { from: 'workspace/a', to: 'projects/book/a' })
    ).toBe('ask')
    // left for Rust to refuse with a reason
    expect(access('read_file', { path: 'nowhere/a.md' })).toBe('allow')

    const asking = await toolsOf(provider, context(settings('ask')))
    expect(
      asking.get('read_file')!.accessFor!({ path: 'workspace/a.md' })
    ).toBe('ask')
  })

  it('remembers "allow in this session" per root', async () => {
    const { provider } = setup()
    const tools = await toolsOf(provider)
    const scope = (name: string, input: unknown) =>
      tools.get(name)!.approvalScope!(input)

    expect(scope('write_file', { path: 'projects/book/a.md' })).toBe(
      'projects/book'
    )
    expect(scope('write_file', { path: 'projects/book/b/c.md' })).toBe(
      'projects/book'
    )
    expect(scope('search_files', {})).toBe('*')
    expect(
      scope('move_path', { from: 'workspace/a', to: 'projects/book/a' })
    ).toBe('workspace>projects/book')
  })

  it('runs a call in Rust and tells the model what it did', async () => {
    const { provider, deps } = setup()
    deps.run.mockResolvedValue({
      operation: 'readFile',
      path: 'workspace/a.md',
      content: 'one\n',
      startLine: 1,
      endLine: 1,
      totalLines: 3,
      nextOffset: 2,
    })
    const tools = await toolsOf(provider)

    const output = await execute(tools.get('read_file'), {
      path: 'workspace/a.md',
      limit: 1,
    })

    expect(deps.run).toHaveBeenCalledWith('writer', {
      operation: 'readFile',
      path: 'workspace/a.md',
      limit: 1,
      maxCharacters: 9_900,
    })
    expect(output).toBe(
      'one\n\n\n[Lines 1-1 of 3 of workspace/a.md. Call read_file with offset 2 for more.]'
    )
  })

  it('reads the text of a document and pages it', async () => {
    const { provider, deps } = setup()
    deps.run.mockResolvedValue({
      operation: 'readDocument',
      path: 'workspace/r.pdf',
      mediaType: 'application/pdf',
    })
    const tools = await toolsOf(provider)

    const output = await execute(tools.get('read_file'), {
      path: 'workspace/r.pdf',
      offset: 2,
    })

    expect(deps.readDocumentText).toHaveBeenCalledWith(
      'writer',
      'workspace/r.pdf',
      'application/pdf'
    )
    expect(output).toBe('page two\n\n\n[Lines 2-2 of 2 of workspace/r.pdf.]')
  })

  it('forwards a partial-line cursor to Rust', async () => {
    const { provider, deps } = setup()
    deps.run.mockResolvedValue({
      operation: 'readFile',
      path: 'workspace/a.md',
      content: 'def',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
    })
    const tools = await toolsOf(provider)
    await execute(tools.get('read_file'), {
      path: 'workspace/a.md',
      offset: 1,
      characterOffset: 3,
    })
    expect(deps.run).toHaveBeenCalledWith(
      'writer',
      expect.objectContaining({ characterOffset: 3 })
    )
  })

  it('continues within a document line using Unicode characters', async () => {
    const { provider, deps } = setup()
    deps.run.mockResolvedValue({
      operation: 'readDocument',
      path: 'workspace/r.pdf',
      mediaType: 'application/pdf',
    })
    deps.readDocumentText.mockResolvedValue('😀é文xyz')
    const tools = await toolsOf(provider)
    expect(
      await execute(tools.get('read_file'), {
        path: 'workspace/r.pdf',
        characterOffset: 3,
      })
    ).toBe('xyz')
  })

  it('keeps the continuation note within the output budget for emoji', async () => {
    const { provider, deps } = setup()
    deps.run.mockResolvedValue({
      operation: 'readDocument',
      path: 'workspace/r.pdf',
      mediaType: 'application/pdf',
    })
    deps.readDocumentText.mockResolvedValue('😀'.repeat(20_000))
    const tools = await toolsOf(provider)
    const output = await execute(tools.get('read_file'), {
      path: 'workspace/r.pdf',
    })
    if (typeof output !== 'string') throw new Error('Expected text output')
    expect(output.length).toBeLessThanOrEqual(20_000)
    expect(output).toContain('offset 1 and characterOffset 9900 for more.')
  })

  it('previews a write or an edit, nothing else', async () => {
    const { provider, deps } = setup()
    deps.preview.mockResolvedValue({
      path: 'workspace/a.md',
      before: 'old',
      after: 'new',
    })
    const tools = await toolsOf(provider)

    expect(
      await tools.get('edit_file')!.preview!(
        { path: 'workspace/a.md', oldText: 'old', newText: 'new' },
        new AbortController().signal
      )
    ).toEqual({
      kind: 'file-change',
      path: 'workspace/a.md',
      before: 'old',
      after: 'new',
    })
    expect(deps.preview).toHaveBeenCalledWith('writer', {
      operation: 'editFile',
      path: 'workspace/a.md',
      oldText: 'old',
      newText: 'new',
    })
    expect(tools.get('delete_path')!.preview).toBeUndefined()
    expect(tools.get('read_file')!.preview).toBeUndefined()
  })

  it('tells the model the folders it reaches, through the registry', async () => {
    const { provider } = setup()
    const registry = createChatToolRegistry({
      providers: () => [provider],
      policy: createChatToolPolicy({ canAsk: true }),
    })

    const set = await registry.resolve(context())

    expect(Object.keys(set!.tools)).toEqual([
      'list_files',
      'read_file',
      'search_files',
      'write_file',
      'edit_file',
      'move_path',
      'delete_path',
    ])
    expect(set!.instructions).toContain('- workspace/ — your own folder')
    expect(set!.instructions).toContain(
      '- projects/book/ — the project "Book" (The novel); reading allowed, changing asks the user first.'
    )
  })
})
