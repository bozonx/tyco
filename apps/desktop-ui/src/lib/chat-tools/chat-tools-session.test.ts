import { chatToolName } from './tool-name'

import { describe, expect, it, vi } from 'vitest'

import { toolContext, toolSettings } from '../../test/chat-tool-context'

import type { ChatToolDefinition, ChatToolProvider } from './chat-tool-registry'
import { createChatToolsSession } from './chat-tools-session'
import { createDebugChatToolProvider } from './debug-chat-tools'
import {
  createReplyBlocksToolProvider,
  REPLY_BLOCKS_TOOL_NAME,
} from '../reply-blocks/reply-blocks-tool'

const readNote: ChatToolDefinition = {
  name: 'read_note',
  source: { kind: 'plugin', id: 'notes' },
  risk: 'write',
  description: 'Reads a note',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => 'text',
}

const notes: ChatToolProvider = { id: 'notes', tools: () => [readNote] }

const request = {
  ...toolContext('writer'),
  modelId: 'model',
  canUseTools: true,
}

const askAi = { ...toolContext(null), modelId: 'model', canUseTools: true }

describe('chat-tools-session', () => {
  it('offers reply blocks to every chat, without asking, even "Ask AI"', async () => {
    const session = createChatToolsSession({
      getMaxStepCount: () => 3,
      providers: () => [createReplyBlocksToolProvider()],
    })

    const tools = await session.toolsFor(askAi)

    expect(Object.keys(tools!.tools!.tools)).toEqual([REPLY_BLOCKS_TOOL_NAME])
    expect(tools!.tools!.instructions).toContain(REPLY_BLOCKS_TOOL_NAME)
    const decide = tools!.tools!.toolApproval as (options: unknown) => unknown
    expect(
      decide({
        toolCall: { toolName: REPLY_BLOCKS_TOOL_NAME, input: { blocks: [] } },
      })
    ).toBe('approved')
  })

  it('gives a turn the tools of its profile and the step limit of the settings', async () => {
    const session = createChatToolsSession({
      providers: () => [notes],
      getMaxStepCount: () => 3,
    })

    const tools = await session.toolsFor(request)

    expect(Object.keys(tools!.tools!.tools)).toEqual(['read_note'])
    expect(tools!.maxStepCount).toBe(3)
  })

  it('gives none to a model without tools or a chat without settings', async () => {
    const session = createChatToolsSession({
      providers: () => [notes],
      getMaxStepCount: () => 3,
    })

    expect(
      await session.toolsFor({ ...request, canUseTools: false })
    ).toBeUndefined()
    // "Ask AI" gets no plugin tools
    expect(await session.toolsFor(askAi)).toBeUndefined()
  })

  it('adds the debug tools when asked', async () => {
    const session = createChatToolsSession({
      getMaxStepCount: () => 3,
      providers: () => [createDebugChatToolProvider()],
    })

    const tools = await session.toolsFor(askAi)

    expect(Object.keys(tools!.tools!.tools)).toEqual([
      await chatToolName('get_current_time'),
    ])
  })

  it('forgets the permissions of a conversation and refuses what waits', async () => {
    const session = createChatToolsSession({
      providers: () => [notes],
      getMaxStepCount: () => 3,
    })
    const tools = (await session.toolsFor(request))!
    tools.policy.answer('read_note', 'allow-session')
    expect(tools.policy.decide('read_note', 'ask')).toBe('approved')

    session.resetPermissions()
    expect(tools.policy.decide('read_note', 'ask')).toBe('user-approval')

    const waiting = tools.requestApproval(
      {
        approvalId: 'a1',
        toolCallId: 'c1',
        toolName: 'read_note',
        input: {},
        approvalKey: 'read_note',
      },
      new AbortController().signal
    )
    await vi.waitFor(() =>
      expect(session.pendingApprovals.value).toHaveLength(1)
    )
    session.dispose()
    expect(await waiting).toBe('deny')
  })

  it('shows what a call would change with its approval request', async () => {
    const preview = {
      kind: 'file-change' as const,
      path: 'workspace/a.md',
      before: null,
      after: 'New',
    }
    const session = createChatToolsSession({
      getMaxStepCount: () => 3,
      providers: () => [
        {
          id: 'files',
          tools: () => [{ ...readNote, preview: async () => preview }],
        },
      ],
    })
    const tools = (await session.toolsFor(request))!

    void tools.requestApproval(
      {
        approvalId: 'a1',
        toolCallId: 'c1',
        toolName: 'read_note',
        input: {},
        approvalKey: 'read_note',
      },
      new AbortController().signal
    )
    await vi.waitFor(() =>
      expect(session.pendingApprovals.value[0]?.preview).toEqual(preview)
    )
    session.dispose()
  })
})

describe('chat-tools-session reserve', () => {
  it('knows without the providers whether a turn may get tools', () => {
    const session = createChatToolsSession({
      providers: () => [],
      getMaxStepCount: () => 3,
    })
    expect(session.mayOfferTools(request)).toBe(true)
    expect(session.mayOfferTools({ ...request, canUseTools: false })).toBe(
      false
    )
    // reply blocks are offered to every chat
    expect(session.mayOfferTools({ canUseTools: true })).toBe(true)
  })
})

describe('chat-tools-session permissions', () => {
  it('keeps the permissions of a chat and gives them back', async () => {
    const onPermissionsChange = vi.fn()
    const session = createChatToolsSession({
      providers: () => [notes],
      getMaxStepCount: () => 3,
      onPermissionsChange,
    })
    const tools = (await session.toolsFor(request))!
    tools.policy.answer('read_note', 'allow-session')
    expect(onPermissionsChange).toHaveBeenLastCalledWith({
      allowed: ['read_note'],
      leakAllowed: [],
    })
    const saved = session.exportPermissions()
    session.resetPermissions()
    expect(tools.policy.decide('read_note', 'ask')).toBe('user-approval')
    session.restorePermissions(saved)
    expect(tools.policy.decide('read_note', 'ask')).toBe('approved')
  })

  it('saves "always allow" before the call runs', async () => {
    const alwaysAllow = vi.fn(async () => {})
    const session = createChatToolsSession({
      providers: () => [notes],
      getMaxStepCount: () => 3,
      alwaysAllow,
    })
    const tools = (await session.toolsFor(request))!
    const target = {
      kind: 'tool' as const,
      source: readNote.source,
      toolName: 'read_note',
    }
    const answer = tools.requestApproval(
      {
        approvalId: 'a1',
        toolCallId: 'c1',
        toolName: 'read_note',
        input: {},
        approvalKey: 'read_note',
        alwaysAllow: target,
      },
      new AbortController().signal
    )
    await vi.waitFor(() =>
      expect(session.pendingApprovals.value[0]?.alwaysAllow).toEqual(target)
    )
    session.answerApproval('a1', 'allow-always')
    expect(await answer).toBe('allow-once')
    expect(alwaysAllow).toHaveBeenCalledWith(target)
  })

  it('asks before a call could take personal data somewhere new', async () => {
    const send: ChatToolDefinition = {
      ...readNote,
      name: 'send',
      risk: 'external',
    }
    const session = createChatToolsSession({
      providers: () => [{ id: 'notes', tools: () => [send] }],
      getMaxStepCount: () => 3,
    })
    const tools = (await session.toolsFor({
      ...toolContext(
        'writer',
        toolSettings({ tools: { 'plugin:notes:send': 'allow' } })
      ),
      modelId: 'model',
      canUseTools: true,
      memoryMode: 'auto',
    }))!
    const decide = tools.tools!.toolApproval as (options: unknown) => unknown
    expect(decide({ toolCall: { toolName: 'send', input: {} } })).toBe(
      'user-approval'
    )
    const info = tools.tools!.approvalInfo('send', {})
    expect(info.leakTarget).toBe('plugin:notes:send')
    expect(info.alwaysAllow).toBeUndefined()
    tools.policy.answer(info.approvalKey, 'allow-once', info.leakTarget)
    expect(decide({ toolCall: { toolName: 'send', input: {} } })).toBe(
      'approved'
    )
  })
})
