import { describe, expect, it, vi } from 'vitest'

import type { ChatToolDefinition, ChatToolProvider } from './chat-tool-registry'
import { createChatToolsSession } from './chat-tools-session'
import { createDebugChatToolProvider } from './debug-chat-tools'

const readNote: ChatToolDefinition = {
  name: 'read_note',
  groupId: 'notes',
  description: 'Reads a note',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => 'text',
}

const notes: ChatToolProvider = { id: 'notes', tools: () => [readNote] }

const request = {
  profileId: 'writer',
  modelId: 'model',
  canUseTools: true,
  settings: {
    groups: { notes: { isEnabled: true, access: 'ask' as const } },
    maxStepCount: 3,
  },
}

describe('chat-tools-session', () => {
  it('gives a turn the tools of its profile and its step limit', async () => {
    const session = createChatToolsSession({ providers: () => [notes] })

    const tools = await session.toolsFor(request)

    expect(Object.keys(tools!.tools!.tools)).toEqual(['read_note'])
    expect(tools!.maxStepCount).toBe(3)
  })

  it('gives none to a model without tools or a chat without settings', async () => {
    const session = createChatToolsSession({ providers: () => [notes] })

    expect(
      await session.toolsFor({ ...request, canUseTools: false })
    ).toBeUndefined()
    expect(
      await session.toolsFor({
        ...request,
        profileId: null,
        settings: undefined,
      })
    ).toBeUndefined()
  })

  it('adds the debug tools when asked, with the default step limit', async () => {
    const session = createChatToolsSession({
      providers: () => [createDebugChatToolProvider()],
      isDebugEnabled: () => true,
    })

    const tools = await session.toolsFor({
      ...request,
      profileId: null,
      settings: undefined,
    })

    expect(Object.keys(tools!.tools!.tools)).toEqual(['get_current_time'])
    expect(tools!.maxStepCount).toBe(8)
  })

  it('forgets the permissions of a conversation and refuses what waits', async () => {
    const session = createChatToolsSession({ providers: () => [notes] })
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
    const session = createChatToolsSession({ providers: () => [] })
    expect(session.mayOfferTools(request)).toBe(true)
    expect(session.mayOfferTools({ ...request, canUseTools: false })).toBe(
      false
    )
    expect(
      session.mayOfferTools({
        canUseTools: true,
        settings: { groups: { notes: { isEnabled: true, access: 'deny' } } },
      })
    ).toBe(false)
    expect(
      createChatToolsSession({
        providers: () => [],
        isDebugEnabled: () => true,
      }).mayOfferTools({ canUseTools: true, settings: undefined })
    ).toBe(true)
  })
})
