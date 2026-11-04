import { dynamicTool, jsonSchema, type ToolSet } from '@bozonx/ai-kit'
import type { ProfileToolSettings } from '@tyco/shared'

import type {
  ChatToolDefinition,
  ChatToolProvider,
  ChatToolSet,
} from '../chat-tools/chat-tool-registry'

export const REPLY_BLOCKS_TOOL_NAME = 'propose_replies'
export const REPLY_BLOCKS_TOOL_GROUP_ID = 'replyBlocks'

export interface ReplyBlockData {
  title?: string
  text: string
}

export interface ProposeRepliesInput {
  blocks: ReplyBlockData[]
}

/**
 * Safely extracts reply blocks from arbitrary tool call input, handling partial
 * or malformed structures gracefully.
 */
export function extractReplyBlocks(input: unknown): ReplyBlockData[] {
  if (!input || typeof input !== 'object') return []

  const target =
    'input' in input && (input as { input: unknown }).input && typeof (input as { input: unknown }).input === 'object'
      ? (input as { input: unknown }).input
      : input

  if (!target || typeof target !== 'object') return []
  const candidate = (target as { blocks?: unknown }).blocks
  if (!Array.isArray(candidate)) return []

  const result: ReplyBlockData[] = []
  for (const item of candidate) {
    if (!item || typeof item !== 'object') continue
    const text = (item as { text?: unknown }).text
    if (typeof text !== 'string' || !text.trim()) continue

    const titleRaw = (item as { title?: unknown }).title
    const title =
      typeof titleRaw === 'string' && titleRaw.trim()
        ? titleRaw.trim()
        : undefined

    result.push({
      ...(title ? { title } : {}),
      text,
    })
  }

  return result
}

/**
 * Chat tool definition for proposing text replacement and reply options.
 * The execute function is a no-op confirmation that acknowledges the blocks were presented.
 */
export function createReplyBlocksTool(): ChatToolDefinition {
  return {
    name: REPLY_BLOCKS_TOOL_NAME,
    groupId: REPLY_BLOCKS_TOOL_GROUP_ID,
    labelKey: 'chatTools.replyBlocks.toolLabel',
    icon: 'mdi:format-list-checks',
    description:
      'Proposes one or more reply or text transformation variants to the user as ready-to-insert blocks. ' +
      'Use this tool whenever you generate the final replacement text, paraphrasing, translation, or answer to be inserted. ' +
      'Provide each variant in its own block containing only the exact text.',
    inputSchema: {
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          description:
            'One or more reply variants/blocks to offer for insertion',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description:
                  'Optional short title or label for the variant (e.g. "Formal", "Concise", "Bullet points")',
              },
              text: {
                type: 'string',
                description:
                  'The exact replacement or reply text ready for insertion, without any meta explanations or markdown fences',
              },
            },
            required: ['text'],
          },
          minItems: 1,
        },
      },
      required: ['blocks'],
    },
    execute: async (input) => {
      const blocks = extractReplyBlocks(input)
      return { ok: true, count: blocks.length }
    },
  }
}

/**
 * Creates a tool provider offering propose_replies to chat sessions.
 */
export function createReplyBlocksToolProvider(): ChatToolProvider {
  const tool = createReplyBlocksTool()
  return {
    id: 'reply-blocks',
    tools: () => [tool],
  }
}

/**
 * Injects the replyBlocks tool group settings into ProfileToolSettings,
 * ensuring propose_replies is enabled and permitted without confirmation.
 */
export function withReplyBlocksToolGroup(
  settings: ProfileToolSettings | undefined
): ProfileToolSettings {
  return {
    ...settings,
    groups: {
      ...settings?.groups,
      [REPLY_BLOCKS_TOOL_GROUP_ID]: {
        isEnabled: true,
        access: 'allow',
      },
    },
  }
}

/**
 * Ensures propose_replies is present in a ChatToolSet with approved execution access.
 */
export function withReplyBlocksTool(set: ChatToolSet | null): ChatToolSet {
  const replyTool = createReplyBlocksTool()
  const definitions = new Map(set?.definitions)
  definitions.set(replyTool.name, replyTool)

  const tools: ToolSet = { ...set?.tools }
  tools[replyTool.name] = dynamicTool({
    description: replyTool.description,
    inputSchema: jsonSchema(replyTool.inputSchema as Parameters<typeof jsonSchema>[0]),
    execute: async (input) => {
      const res = await replyTool.execute(input, {
        signal: new AbortController().signal,
        toolCallId: 'propose_replies',
        outputLimitCharacters: 100_000,
      })
      return JSON.stringify(res)
    },
  })

  return {
    tools,
    definitions,
    truncatedCallIds: set?.truncatedCallIds ?? new Set(),
    approvalKey: (toolName, input) =>
      toolName === replyTool.name
        ? toolName
        : set?.approvalKey
          ? set.approvalKey(toolName, input)
          : toolName,
    toolApproval: (context) =>
      context.toolCall.toolName === replyTool.name
        ? 'approved'
        : typeof set?.toolApproval === 'function'
          ? set.toolApproval(context)
          : 'denied',
    instructions: set?.instructions,
  }
}
