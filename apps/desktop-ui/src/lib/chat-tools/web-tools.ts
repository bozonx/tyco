import type {
  AiWebToolOutput,
  AiWebToolRequest,
  WebSearchResultItem,
} from '@tyco/shared'
import type { JsonSchema } from '@tyco/plugin-sdk'

import { WEB_TOOL_GROUP_ID } from './chat-tool-groups'
import type {
  ChatToolContext,
  ChatToolDefinition,
  ChatToolExecuteOptions,
  ChatToolProvider,
} from './chat-tool-registry'

export interface WebToolsDependencies {
  /** Runs a call; `runId` lets `cancel` stop the request in the backend */
  run: (
    profileId: string,
    request: AiWebToolRequest,
    runId?: string
  ) => Promise<AiWebToolOutput>
  cancel?: (runId: string) => void
  getMaxCharacters?: () => number | undefined
  warn?: (message: string) => void
}

type Input = Record<string, unknown>

const asInput = (input: unknown): Input =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Input)
    : {}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** Room left in the output for the page title, source and the note */
const PAGE_FRAME_CHARACTERS = 500

const withAbort = async <T>(
  start: () => Promise<T>,
  signal: AbortSignal,
  onAbort?: () => void
): Promise<T> => {
  if (signal.aborted) {
    throw new Error('The tool call was cancelled')
  }
  const promise = start()
  return new Promise<T>((resolve, reject) => {
    const onAbortSignal = () => {
      onAbort?.()
      reject(new Error('The tool call was cancelled'))
    }
    signal.addEventListener('abort', onAbortSignal, { once: true })
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbortSignal)
        resolve(val)
      },
      (err) => {
        signal.removeEventListener('abort', onAbortSignal)
        reject(err)
      }
    )
  })
}

const QUERY: JsonSchema = {
  type: 'string',
  description: 'The search query to look up on the web',
}

const COUNT: JsonSchema = {
  type: 'number',
  description:
    'The maximum number of search results to return (1 to 20, default 5)',
}

const URL_INPUT: JsonSchema = {
  type: 'string',
  description: 'The HTTP or HTTPS URL of the web page to fetch',
}

const OFFSET: JsonSchema = {
  type: 'number',
  description:
    'The character to start reading at, to continue a page that was cut (default 0)',
}

const hostOf = (input: unknown) => {
  try {
    return new URL(text(asInput(input).url).trim()).host || undefined
  } catch {
    return undefined
  }
}

export function formatSearchResults(
  results: readonly WebSearchResultItem[]
): string {
  if (results.length === 0) {
    return 'No results found.'
  }

  return results
    .map((item, index) => {
      const parts = [
        `### ${index + 1}. [${item.title || item.url}](${item.url})`,
      ]
      if (item.description) {
        parts.push(item.description)
      }
      return parts.join('\n\n')
    })
    .join('\n\n---\n\n')
}

export function formatFetchedPage(output: {
  url: string
  title?: string
  content: string
  offset?: number
  totalCharacters?: number
}): string {
  const parts: string[] = []
  if (output.title) {
    parts.push(`# ${output.title}`)
  }
  parts.push(`Source: ${output.url}`)
  if (output.content) {
    parts.push(output.content)
  }
  const start = output.offset ?? 0
  const end = start + [...output.content].length
  const total = output.totalCharacters ?? end
  if (start > 0 || end < total) {
    const next =
      end < total
        ? ` Call web_fetch with offset ${end} to read on.`
        : ' This is the end of the page.'
    parts.push(`[Characters ${start}–${end} of ${total}.${next}]`)
  }
  return parts.join('\n\n')
}

export function createWebToolProvider(
  deps: WebToolsDependencies
): ChatToolProvider {
  return {
    id: WEB_TOOL_GROUP_ID,
    tools: (_context: ChatToolContext): ChatToolDefinition[] => {
      const profileId = _context.profileId
      if (!profileId) {
        return []
      }

      return [
        {
          name: 'web_search',
          groupId: WEB_TOOL_GROUP_ID,
          labelKey: 'chatTools.web.searchLabel',
          icon: 'mdi:search-web',
          description:
            'Searches the web for up-to-date information, documentation, news, or articles using Jina AI. Returns search results with titles, URLs, and summaries.',
          inputSchema: {
            type: 'object',
            properties: { query: QUERY, count: COUNT },
            required: ['query'],
          },
          execute: async (input: unknown, options: ChatToolExecuteOptions) => {
            const args = asInput(input)
            const query = text(args.query).trim()
            if (!query) throw new Error('Search query cannot be empty')
            const resultCount = count(args.count)

            const runId = `web-${options.toolCallId}`
            const response = await withAbort(
              () =>
                deps.run(
                  profileId,
                  { operation: 'search', query, count: resultCount },
                  runId
                ),
              options.signal,
              () => deps.cancel?.(runId)
            )

            if (response.operation !== 'search') {
              throw new Error('Unexpected response operation from web search')
            }

            const formatted = formatSearchResults(response.results)
            return formatted
          },
        },
        {
          name: 'web_fetch',
          groupId: WEB_TOOL_GROUP_ID,
          labelKey: 'chatTools.web.fetchLabel',
          icon: 'mdi:web',
          description:
            'Fetches and converts the full content of a web page into clean Markdown using Jina Reader. Use this to read the details of a specific URL found in search results. A long page comes in parts: pass the offset from the note to read on.',
          inputSchema: {
            type: 'object',
            properties: { url: URL_INPUT, offset: OFFSET },
            required: ['url'],
          },
          approvalScope: hostOf,
          outputLimitCharacters: deps.getMaxCharacters?.(),
          execute: async (input: unknown, options: ChatToolExecuteOptions) => {
            const args = asInput(input)
            const url = text(args.url).trim()
            if (!url) throw new Error('URL cannot be empty')

            const offset = Math.max(0, Math.floor(count(args.offset) ?? 0))

            const configuredMax = deps.getMaxCharacters?.()
            const limit =
              configuredMax !== undefined
                ? Math.min(configuredMax, options.outputLimitCharacters)
                : options.outputLimitCharacters
            const maxCharacters = Math.max(1, limit - PAGE_FRAME_CHARACTERS)

            const runId = `web-${options.toolCallId}`
            const response = await withAbort(
              () =>
                deps.run(
                  profileId,
                  {
                    operation: 'fetch',
                    url,
                    maxCharacters,
                    ...(offset > 0 ? { offset } : {}),
                  },
                  runId
                ),
              options.signal,
              () => deps.cancel?.(runId)
            )

            if (response.operation !== 'fetch') {
              throw new Error('Unexpected response operation from web fetch')
            }

            const formatted = formatFetchedPage(response)
            return formatted
          },
        },
      ]
    },
  }
}
