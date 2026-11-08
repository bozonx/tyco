import { describe, expect, it, vi } from 'vitest'

import type { AiWebToolOutput } from '@tyco/shared'

import {
  createWebToolProvider,
  formatFetchedPage,
  formatSearchResults,
} from './web-tools'

describe('web-tools', () => {
  it('formats search results cleanly without full page content', () => {
    const formatted = formatSearchResults([
      {
        title: 'Jina AI',
        url: 'https://jina.ai',
        description: 'Search Foundation',
        content: 'Markdown content snippet',
      },
    ])

    expect(formatted).toContain('### 1. [Jina AI](https://jina.ai)')
    expect(formatted).toContain('Search Foundation')
    expect(formatted).not.toContain('Markdown content snippet')
  })

  it('formats empty search results', () => {
    expect(formatSearchResults([])).toBe('No results found.')
  })

  it('returns no tools when profileId is null', async () => {
    const run = vi.fn()
    const provider = createWebToolProvider({ run })
    const tools = await provider.tools({
      profileId: null,
      modelId: 'gemini',
      settings: undefined,
    })
    expect(tools).toEqual([])
  })

  it('formats fetched webpage', () => {
    const formatted = formatFetchedPage({
      url: 'https://example.com',
      title: 'Example Domain',
      content: 'This domain is for use in illustrative examples.',
    })

    expect(formatted).toContain('# Example Domain')
    expect(formatted).toContain('Source: https://example.com')
    expect(formatted).toContain(
      'This domain is for use in illustrative examples.'
    )
  })

  it('executes web_search tool correctly', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({
        operation: 'search',
        results: [
          {
            title: 'Test Title',
            url: 'https://test.com',
            description: 'A test result',
          },
        ],
      } satisfies AiWebToolOutput)

    const provider = createWebToolProvider({ run })
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gemini',
      settings: undefined,
    })

    const searchTool = tools.find((t) => t.name === 'web_search')
    expect(searchTool).toBeDefined()

    const result = await searchTool!.execute(
      { query: 'test query', count: 3 },
      {
        signal: new AbortController().signal,
        toolCallId: 'call-1',
        outputLimitCharacters: 5000,
      }
    )

    expect(run).toHaveBeenCalledWith(
      'prof-1',
      { operation: 'search', query: 'test query', count: 3 },
      'web-call-1'
    )
    expect(result).toContain('[Test Title](https://test.com)')
  })

  it('executes web_fetch tool correctly', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({
        operation: 'fetch',
        url: 'https://example.com/page',
        title: 'Page Title',
        content: 'Page content here.',
        offset: 0,
        totalCharacters: 18,
      } satisfies AiWebToolOutput)

    const provider = createWebToolProvider({ run })
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gemini',
      settings: undefined,
    })

    const fetchTool = tools.find((t) => t.name === 'web_fetch')
    expect(fetchTool).toBeDefined()

    const result = await fetchTool!.execute(
      { url: 'https://example.com/page' },
      {
        signal: new AbortController().signal,
        toolCallId: 'call-2',
        outputLimitCharacters: 5000,
      }
    )

    expect(run).toHaveBeenCalledWith(
      'prof-1',
      {
        operation: 'fetch',
        url: 'https://example.com/page',
        maxCharacters: 4500,
      },
      'web-call-2'
    )
    expect(result).not.toContain('Characters')
    expect(result).toContain('# Page Title')
    expect(result).toContain('Source: https://example.com/page')
    expect(result).toContain('Page content here.')
  })

  it('passes min of configured maxCharacters and outputLimitCharacters to web_fetch', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({
        operation: 'fetch',
        url: 'https://example.com/page',
        title: 'Page Title',
        content: 'Truncated page content.',
        offset: 0,
        totalCharacters: 23,
      } satisfies AiWebToolOutput)

    const provider = createWebToolProvider({
      run,
      getMaxCharacters: () => 8000,
    })
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gemini',
      settings: undefined,
    })

    const fetchTool = tools.find((t) => t.name === 'web_fetch')!
    expect(fetchTool.outputLimitCharacters).toBe(8000)

    // When outputLimit is smaller than configured max, use outputLimit
    await fetchTool.execute(
      { url: 'https://example.com/page' },
      {
        signal: new AbortController().signal,
        toolCallId: 'call-2',
        outputLimitCharacters: 5000,
      }
    )

    expect(run).toHaveBeenCalledWith(
      'prof-1',
      {
        operation: 'fetch',
        url: 'https://example.com/page',
        maxCharacters: 4500,
      },
      'web-call-2'
    )

    // When configured max is smaller than outputLimit, use configured max
    await fetchTool.execute(
      { url: 'https://example.com/page' },
      {
        signal: new AbortController().signal,
        toolCallId: 'call-3',
        outputLimitCharacters: 12000,
      }
    )

    expect(run).toHaveBeenCalledWith(
      'prof-1',
      {
        operation: 'fetch',
        url: 'https://example.com/page',
        maxCharacters: 7500,
      },
      'web-call-3'
    )
  })

  it('notes where a cut page goes on and passes the offset back', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({
        operation: 'fetch',
        url: 'https://example.com/page',
        content: 'abc',
        offset: 10,
        totalCharacters: 20,
      } satisfies AiWebToolOutput)
    const provider = createWebToolProvider({ run })
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gemini',
      settings: undefined,
    })
    const fetchTool = tools.find((t) => t.name === 'web_fetch')!

    const result = await fetchTool.execute(
      { url: 'https://example.com/page', offset: 10 },
      {
        signal: new AbortController().signal,
        toolCallId: 'call-5',
        outputLimitCharacters: 5000,
      }
    )

    expect(run.mock.calls[0]?.[1]).toMatchObject({ offset: 10 })
    expect(result).toContain(
      '[Characters 10–13 of 20. Call web_fetch with offset 13 to read on.]'
    )
  })

  it('scopes the session approval of web_fetch to the host', async () => {
    const provider = createWebToolProvider({ run: vi.fn() })
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gemini',
      settings: undefined,
    })
    const fetchTool = tools.find((t) => t.name === 'web_fetch')!
    expect(
      fetchTool.approvalScope?.({ url: 'https://a.example.com/x?y' })
    ).toBe('a.example.com')
    expect(fetchTool.approvalScope?.({ url: 'nonsense' })).toBeUndefined()
  })

  it('cancels the backend request when the call is aborted', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const run = vi.fn(() => new Promise<never>(() => {}))
    const provider = createWebToolProvider({ run, cancel })
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gemini',
      settings: undefined,
    })
    const promise = tools
      .find((t) => t.name === 'web_fetch')!
      .execute(
        { url: 'https://example.com' },
        {
          signal: controller.signal,
          toolCallId: 'call-6',
          outputLimitCharacters: 5000,
        }
      )
    controller.abort()
    await expect(promise).rejects.toThrow('The tool call was cancelled')
    expect(cancel).toHaveBeenCalledWith('web-call-6')
  })

  it('rejects empty query in web_search', async () => {
    const run = vi.fn()
    const provider = createWebToolProvider({ run })
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gemini',
      settings: undefined,
    })

    const searchTool = tools.find((t) => t.name === 'web_search')!
    await expect(
      searchTool.execute(
        { query: '   ' },
        {
          signal: new AbortController().signal,
          toolCallId: 'call-3',
          outputLimitCharacters: 1000,
        }
      )
    ).rejects.toThrow('Search query cannot be empty')
  })

  it('rejects when execution is aborted', async () => {
    const controller = new AbortController()
    const run = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 500)
        })
    )
    const provider = createWebToolProvider({ run })
    const tools = await provider.tools({
      profileId: 'prof-1',
      modelId: 'gemini',
      settings: undefined,
    })

    const searchTool = tools.find((t) => t.name === 'web_search')!
    const promise = searchTool.execute(
      { query: 'test' },
      {
        signal: controller.signal,
        toolCallId: 'call-4',
        outputLimitCharacters: 1000,
      }
    )
    controller.abort()
    await expect(promise).rejects.toThrow('The tool call was cancelled')
  })
})
