import { toolContext } from '../../test/chat-tool-context'
import { describe, expect, it } from 'vitest'

import {
  createReplyBlocksTool,
  createReplyBlocksToolProvider,
  extractReplyBlocks,
  REPLY_BLOCKS_TOOL_NAME,
} from './reply-blocks-tool'

describe('reply-blocks-tool', () => {
  describe('extractReplyBlocks', () => {
    it('returns empty array for non-objects or missing blocks', () => {
      expect(extractReplyBlocks(null)).toEqual([])
      expect(extractReplyBlocks(undefined)).toEqual([])
      expect(extractReplyBlocks('invalid')).toEqual([])
      expect(extractReplyBlocks({})).toEqual([])
      expect(extractReplyBlocks({ blocks: 'not-array' })).toEqual([])
    })

    it('extracts valid blocks and filters out empty texts', () => {
      const input = {
        blocks: [
          { title: 'Option 1', text: 'Hello world' },
          { title: '   ', text: 'Second option' },
          { text: 'Third option without title' },
          { title: 'No text', text: '   ' },
          null,
          123,
        ],
      }

      expect(extractReplyBlocks(input)).toEqual([
        { title: 'Option 1', text: 'Hello world' },
        { text: 'Second option' },
        { text: 'Third option without title' },
      ])
    })
  })

  describe('createReplyBlocksTool', () => {
    it('creates tool definition with expected metadata and schema', async () => {
      const tool = createReplyBlocksTool()
      expect(tool.name).toBe(REPLY_BLOCKS_TOOL_NAME)
      expect(tool.source).toEqual({ kind: 'core', id: 'replyBlocks' })
      expect(tool.inputSchema.required).toContain('blocks')

      const result = await tool.execute(
        { blocks: [{ text: 'Answer' }] },
        {
          signal: new AbortController().signal,
          toolCallId: 'call_1',
          outputLimitCharacters: 1000,
        }
      )

      expect(result).toEqual({ ok: true, count: 1 })
    })
  })

  describe('createReplyBlocksToolProvider', () => {
    it('returns provider offering the reply blocks tool', async () => {
      const provider = createReplyBlocksToolProvider()
      expect(provider.id).toBe('reply-blocks')

      const tools = await provider.tools({
        ...toolContext(null),
        modelId: 'test-model',
      })

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe(REPLY_BLOCKS_TOOL_NAME)
    })
  })
})
