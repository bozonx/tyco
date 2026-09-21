import { APP_CONFIG } from './app-config'
import type { ChatMessage } from './desktop'
import type { LlmModel } from './user-config'

export interface ChatCompletionResult {
  content?: string
  error?: string
  status?: number
  statusText?: string
}

export const useAiRequest = () => {
  function parseOpenAiStreamChunk(line: string): string {
    if (!line.startsWith('data: ')) {
      return ''
    }

    const payload = line.slice(6).trim()

    if (!payload || payload === '[DONE]') {
      return ''
    }

    try {
      const data = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>
      }
      return data.choices?.[0]?.delta?.content || ''
    } catch {
      return ''
    }
  }

  async function readStreamingLines(
    stream: ReadableStream<Uint8Array>,
    onLine: (line: string) => string
  ) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let content = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const text = onLine(line)

        if (text) {
          content += text
        }
      }
    }

    buffer += decoder.decode()

    if (buffer.trim()) {
      const text = onLine(buffer)

      if (text) {
        content += text
      }
    }

    return content
  }

  const prepareDevInstructions = (
    devInstructions: string,
    devInstructionsData?: Record<string, string>
  ) => {
    let result = devInstructions

    if (devInstructionsData) {
      Object.entries(devInstructionsData).forEach(([key, value]) => {
        result = result.replace('{{' + key + '}}', value)
      })
    }

    return result
  }

  function prepareAiMessages(
    rawMessages: string | ChatMessage[],
    rules?: string,
    devInstructions?: string
  ) {
    const messages: ChatMessage[] = []

    if (devInstructions) {
      messages.push({ role: 'developer', content: devInstructions.trim() })
    }

    if (rules) {
      messages.push({
        role: 'user',
        content: APP_CONFIG.rulePrefix + ':\n\n' + rules.trim(),
      })
    }

    if (Array.isArray(rawMessages)) {
      messages.push(
        ...rawMessages.map((item) => ({
          ...item,
          content: item.content.trim(),
        }))
      )
    } else {
      messages.push({ role: 'user', content: rawMessages.trim() })
    }

    return messages
  }

  async function chatCompletion(
    model: LlmModel,
    messages: string | ChatMessage[],
    options?: { onChunk?: (chunk: string) => void; signal?: AbortSignal }
  ): Promise<ChatCompletionResult> {
    return await openAiCompatibleChatCompletion(model, messages, options)
  }

  async function openAiCompatibleChatCompletion(
    model: LlmModel,
    messages: string | ChatMessage[],
    options?: { onChunk?: (chunk: string) => void; signal?: AbortSignal }
  ): Promise<ChatCompletionResult> {
    const normalizedMessages = Array.isArray(messages)
      ? messages.map((message) => ({
          role: message.role === 'developer' ? 'system' : message.role,
          content: message.content,
        }))
      : [{ role: 'user', content: messages }]

    try {
      const result = await fetch(
        (model.baseUrl || '').replace(/\/$/, '') + '/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + (model.apiKey || ''),
            'X-Title': 'TyCo',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: model.model,
            messages: normalizedMessages,
            stream: !!options?.onChunk,
            temperature: model.temperature ?? 0.2,
            max_tokens: model.maxTokens ?? 512,
          }),
          signal: options?.signal,
        }
      )

      if (!result.ok) {
        const body = await result.text()
        return {
          error: body,
          status: result.status,
          statusText: result.statusText,
        }
      }

      if (options?.onChunk && result.body) {
        const content = await readStreamingLines(result.body, (line) => {
          const text = parseOpenAiStreamChunk(line)
          if (text) {
            options.onChunk?.(text)
          }
          return text
        })
        return { content }
      }

      const data = (await result.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      return data.choices?.[0]?.message || { content: '' }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return { content: '' } // Aborted
      }
      throw e
    }
  }

  return { chatCompletion, prepareAiMessages, prepareDevInstructions }
}
