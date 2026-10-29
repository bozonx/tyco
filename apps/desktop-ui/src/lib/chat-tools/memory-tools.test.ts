import { describe, expect, it, vi } from 'vitest'

import { createChatToolApprovals } from './chat-tool-approvals'
import { createChatToolPolicy } from './chat-tool-policy'
import { createChatToolRegistry } from './chat-tool-registry'
import {
  createMemoryToolProvider,
  MEMORY_INSTRUCTIONS_FULL,
  MEMORY_INSTRUCTIONS_READ_ONLY,
  MEMORY_TOOL_GROUP_ID,
  type MemoryToolsDependencies,
  withMemoryToolGroup,
} from './memory-tools'

function createFakeMemoryDeps(
  overrides?: Partial<MemoryToolsDependencies>
): MemoryToolsDependencies {
  return {
    readMemory: vi.fn(async (_profileId: string, file: string) => {
      if (file === 'core.md') return '# Core\n- Fact 1'
      if (file === 'health.md') return '# Health\n- Allergy to dust'
      return ''
    }),
    searchMemory: vi.fn(async () => [
      { file: 'health.md', lineNumber: 2, text: '- Allergy to dust' },
    ]),
    addFact: vi.fn(async (_profileId, file, _fact) => ({
      file,
      after: 'updated',
    })),
    replaceMemory: vi.fn(async (_profileId, file, _old, _new) => ({
      file,
      after: 'updated',
    })),
    rewriteMemory: vi.fn(async (_profileId, file, _content) => ({
      file,
      after: 'rewritten',
    })),
    getMemoryMode: vi.fn(() => 'auto' as const),
    getChatId: vi.fn(() => 'chat-123'),
    ...overrides,
  }
}

describe('memory-tools', () => {
  it('registers all 5 tools in auto mode with allow access', async () => {
    const deps = createFakeMemoryDeps()
    const provider = createMemoryToolProvider(deps)
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gpt-4',
      settings: undefined,
      memoryMode: 'auto',
    })

    expect(tools.map((t) => t.name)).toEqual([
      'memory_read',
      'memory_search',
      'memory_add',
      'memory_replace',
      'memory_rewrite',
    ])

    for (const tool of tools) {
      expect(tool.groupId).toBe(MEMORY_TOOL_GROUP_ID)
      expect(tool.accessFor?.({})).toBe('allow')
    }

    expect(
      provider.instructions?.({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'auto',
      })
    ).toBe(MEMORY_INSTRUCTIONS_FULL)
  })

  it('sets write tools access to ask in ask mode', async () => {
    const deps = createFakeMemoryDeps()
    const provider = createMemoryToolProvider(deps)
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gpt-4',
      settings: undefined,
      memoryMode: 'ask',
    })

    const readTool = tools.find((t) => t.name === 'memory_read')
    const addTool = tools.find((t) => t.name === 'memory_add')
    const replaceTool = tools.find((t) => t.name === 'memory_replace')
    const rewriteTool = tools.find((t) => t.name === 'memory_rewrite')

    expect(readTool?.accessFor?.({})).toBe('allow')
    expect(addTool?.accessFor?.({})).toBe('ask')
    expect(replaceTool?.accessFor?.({})).toBe('ask')
    expect(rewriteTool?.accessFor?.({})).toBe('ask')
  })

  it('only registers read tools in read-only mode and provides read-only instructions', async () => {
    const deps = createFakeMemoryDeps()
    const provider = createMemoryToolProvider(deps)
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gpt-4',
      settings: undefined,
      memoryMode: 'read-only',
    })

    expect(tools.map((t) => t.name)).toEqual(['memory_read', 'memory_search'])
    expect(
      provider.instructions?.({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'read-only',
      })
    ).toBe(MEMORY_INSTRUCTIONS_READ_ONLY)
  })

  it('returns no tools and no instructions in off mode or when profileId is null', async () => {
    const deps = createFakeMemoryDeps()
    const provider = createMemoryToolProvider(deps)

    expect(
      await provider.tools({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'off',
      })
    ).toEqual([])
    expect(
      provider.instructions?.({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'off',
      })
    ).toBeUndefined()

    expect(
      await provider.tools({
        profileId: null,
        modelId: 'gpt-4',
        settings: undefined,
      })
    ).toEqual([])
    expect(
      provider.instructions?.({
        profileId: null,
        modelId: 'gpt-4',
        settings: undefined,
      })
    ).toBeUndefined()
  })

  describe('tool execution', () => {
    it('executes memory_read', async () => {
      const deps = createFakeMemoryDeps()
      const provider = createMemoryToolProvider(deps)
      const tools = await provider.tools({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'auto',
      })
      const readTool = tools.find((t) => t.name === 'memory_read')!

      const result = await readTool.execute(
        { file: 'core.md' },
        {
          signal: new AbortController().signal,
          toolCallId: 'call-1',
          outputLimitCharacters: 1000,
        }
      )
      expect(deps.readMemory).toHaveBeenCalledWith('prof-1', 'core.md')
      expect(result).toBe('# Core\n- Fact 1')
    })

    it('executes memory_search and formats results', async () => {
      const deps = createFakeMemoryDeps()
      const provider = createMemoryToolProvider(deps)
      const tools = await provider.tools({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'auto',
      })
      const searchTool = tools.find((t) => t.name === 'memory_search')!

      const result = await searchTool.execute(
        { query: 'dust' },
        {
          signal: new AbortController().signal,
          toolCallId: 'call-2',
          outputLimitCharacters: 1000,
        }
      )
      expect(deps.searchMemory).toHaveBeenCalledWith('prof-1', 'dust')
      expect(result).toBe('health.md:2: - Allergy to dust')

      // Empty search
      vi.mocked(deps.searchMemory).mockResolvedValueOnce([])
      const emptyResult = await searchTool.execute(
        { query: 'cats' },
        {
          signal: new AbortController().signal,
          toolCallId: 'call-3',
          outputLimitCharacters: 1000,
        }
      )
      expect(emptyResult).toBe('No matches found in memory.')
    })

    it('executes memory_add passing chatId and returns confirmation', async () => {
      const deps = createFakeMemoryDeps()
      const provider = createMemoryToolProvider(deps)
      const tools = await provider.tools({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'auto',
      })
      const addTool = tools.find((t) => t.name === 'memory_add')!

      const result = await addTool.execute(
        { file: 'health.md', fact: 'Lactose intolerance' },
        {
          signal: new AbortController().signal,
          toolCallId: 'call-4',
          outputLimitCharacters: 1000,
        }
      )
      expect(deps.addFact).toHaveBeenCalledWith(
        'prof-1',
        'health.md',
        'Lactose intolerance',
        'chat-123'
      )
      expect(result).toBe('Added fact to health.md')
    })

    it('executes memory_replace and returns replacement or removal confirmation', async () => {
      const deps = createFakeMemoryDeps()
      const provider = createMemoryToolProvider(deps)
      const tools = await provider.tools({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'auto',
      })
      const replaceTool = tools.find((t) => t.name === 'memory_replace')!

      const replaceResult = await replaceTool.execute(
        { file: 'health.md', old: 'Allergy to dust', new: 'Mild dust allergy' },
        {
          signal: new AbortController().signal,
          toolCallId: 'call-5',
          outputLimitCharacters: 1000,
        }
      )
      expect(deps.replaceMemory).toHaveBeenCalledWith(
        'prof-1',
        'health.md',
        'Allergy to dust',
        'Mild dust allergy',
        'chat-123'
      )
      expect(replaceResult).toBe('Replaced text in health.md')

      const removeResult = await replaceTool.execute(
        { file: 'health.md', old: 'Allergy to dust', new: '' },
        {
          signal: new AbortController().signal,
          toolCallId: 'call-6',
          outputLimitCharacters: 1000,
        }
      )
      expect(removeResult).toBe('Removed text from health.md')
    })

    it('executes memory_rewrite and returns confirmation', async () => {
      const deps = createFakeMemoryDeps()
      const provider = createMemoryToolProvider(deps)
      const tools = await provider.tools({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'auto',
      })
      const rewriteTool = tools.find((t) => t.name === 'memory_rewrite')!

      const result = await rewriteTool.execute(
        { file: 'core.md', content: '# Compact Core\n- Fact' },
        {
          signal: new AbortController().signal,
          toolCallId: 'call-7',
          outputLimitCharacters: 1000,
        }
      )
      expect(deps.rewriteMemory).toHaveBeenCalledWith(
        'prof-1',
        'core.md',
        '# Compact Core\n- Fact',
        'chat-123'
      )
      expect(result).toBe('Rewrote core.md')
    })
  })

  describe('tool previews', () => {
    it('generates file diff preview for memory_add', async () => {
      const deps = createFakeMemoryDeps()
      const provider = createMemoryToolProvider(deps)
      const tools = await provider.tools({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'auto',
      })
      const addTool = tools.find((t) => t.name === 'memory_add')!

      const preview = await addTool.preview!(
        { file: 'health.md', fact: 'Lactose intolerance' },
        new AbortController().signal
      )
      expect(preview).toEqual({
        kind: 'file-change',
        path: 'memory/health.md',
        before: '# Health\n- Allergy to dust',
        after: '# Health\n- Allergy to dust\n- Lactose intolerance\n',
      })

      // When file is new
      vi.mocked(deps.readMemory).mockRejectedValueOnce(new Error('not found'))
      const newFilePreview = await addTool.preview!(
        { file: 'habits.md', fact: 'Wakes up at 7am' },
        new AbortController().signal
      )
      expect(newFilePreview).toEqual({
        kind: 'file-change',
        path: 'memory/habits.md',
        before: null,
        after: '# habits\n\n- Wakes up at 7am\n',
      })
    })

    it('generates file diff preview for memory_replace and memory_rewrite', async () => {
      const deps = createFakeMemoryDeps()
      const provider = createMemoryToolProvider(deps)
      const tools = await provider.tools({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings: undefined,
        memoryMode: 'auto',
      })
      const replaceTool = tools.find((t) => t.name === 'memory_replace')!
      const rewriteTool = tools.find((t) => t.name === 'memory_rewrite')!

      const replacePreview = await replaceTool.preview!(
        {
          file: 'health.md',
          old: 'Allergy to dust',
          new: 'Severe dust allergy',
        },
        new AbortController().signal
      )
      expect(replacePreview).toEqual({
        kind: 'file-change',
        path: 'memory/health.md',
        before: '# Health\n- Allergy to dust',
        after: '# Health\n- Severe dust allergy',
      })

      const rewritePreview = await rewriteTool.preview!(
        { file: 'core.md', content: '# Rewritten' },
        new AbortController().signal
      )
      expect(rewritePreview).toEqual({
        kind: 'file-change',
        path: 'memory/core.md',
        before: '# Core\n- Fact 1',
        after: '# Rewritten',
      })
    })
  })

  describe('registry integration and approvals', () => {
    it('requires approval in ask mode and allows execution upon approval', async () => {
      const deps = createFakeMemoryDeps()
      const provider = createMemoryToolProvider(deps)
      const policy = createChatToolPolicy({ canAsk: true })
      const approvals = createChatToolApprovals()
      const registry = createChatToolRegistry({
        providers: () => [provider],
        policy,
      })

      const settings = withMemoryToolGroup(undefined, 'ask')
      const toolSet = await registry.resolve({
        profileId: 'prof-1',
        modelId: 'gpt-4',
        settings,
        memoryMode: 'ask',
      })

      expect(toolSet).not.toBeNull()
      const addTool = toolSet!.tools['memory_add']
      expect(addTool).toBeDefined()

      // Ask mode: tool approval returns 'user-approval'
      const decide = (toolSet!.toolApproval as (options: unknown) => unknown)({
        toolCall: {
          toolCallId: 'c1',
          toolName: 'memory_add',
          input: { file: 'health.md', fact: 'Fact' },
        },
      })
      expect(decide).toBe('user-approval')

      // Request approval through chat-tool-approvals
      const pendingPromise = approvals.request(
        {
          approvalId: 'app-1',
          toolCallId: 'c1',
          toolName: 'memory_add',
          input: { file: 'health.md', fact: 'Fact' },
          approvalKey: 'memory_add:health.md',
        },
        new AbortController().signal
      )
      expect(approvals.pending.value).toHaveLength(1)
      approvals.answer('app-1', 'allow-once')
      const approved = await pendingPromise
      expect(approved).toBe('allow-once')
    })
  })

  describe('withMemoryToolGroup helper', () => {
    it('adds memory tool group based on mode', () => {
      expect(withMemoryToolGroup(undefined, 'off')).toBeUndefined()
      expect(withMemoryToolGroup(undefined, 'auto')).toEqual({
        groups: {
          [MEMORY_TOOL_GROUP_ID]: { isEnabled: true, access: 'allow' },
        },
      })
      expect(withMemoryToolGroup(undefined, 'ask')).toEqual({
        groups: { [MEMORY_TOOL_GROUP_ID]: { isEnabled: true, access: 'ask' } },
      })
      expect(withMemoryToolGroup(undefined, 'read-only')).toEqual({
        groups: {
          [MEMORY_TOOL_GROUP_ID]: { isEnabled: true, access: 'allow' },
        },
      })
    })
  })
})
