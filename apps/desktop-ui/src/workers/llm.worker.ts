import {
  type TextGenerationPipeline,
  env,
  pipeline,
} from '@huggingface/transformers'
import type { WorkerResponse } from '../utils/llm/worker-protocol'

type ChatMessage = {
  role: 'user' | 'assistant' | 'developer'
  content: string
}

type WorkerMessage =
  | {
      type: 'init'
      id: number
      data: { modelUrl: string }
    }
  | {
      type: 'generate'
      id: number
      data: {
        modelName: string
        messages: ChatMessage[]
        temperature?: number
        maxTokens?: number
        stream?: boolean
      }
    }

env.allowRemoteModels = false
env.allowLocalModels = true
env.useBrowserCache = false

let generator: TextGenerationPipeline | null = null
let currentModelName: string | null = null

function toModelDirName(modelName: string) {
  return modelName.replace(/\//g, '_')
}

async function getGenerator(modelName: string, requestId: number) {
  if (generator && currentModelName === modelName) {
    return generator
  }

  currentModelName = modelName

  const progress_callback = (progress: {
    status?: string
    file?: string
    progress?: number
  }) => {
    self.postMessage({
      type: 'progress',
      id: requestId,
      data: {
        status: progress.status || 'loading',
        file: progress.file,
        progress: progress.progress,
      },
    } satisfies WorkerResponse)
  }

  env.backends.onnx.gpu = false
  generator = (await pipeline('text-generation', toModelDirName(modelName), {
    device: 'wasm',
    dtype: 'q4',
    progress_callback,
  } as any)) as TextGenerationPipeline

  // transformers.js alpha expects a scalar kv_cache_dtype, but some model
  // configs ship a dtype map object (e.g. { q4f16: "float16", fp16: "float16" }).
  // That object reaches Tensor(...) and crashes generation in addPastKeyValues().
  const model = (generator as any)?.model
  const kvCacheDtype = model?.custom_config?.kv_cache_dtype
  if (kvCacheDtype && typeof kvCacheDtype === 'object') {
    model.custom_config.kv_cache_dtype = 'float32'
    console.debug('[llm.worker] normalized kv_cache_dtype to float32')
  }

  return generator
}

function normalizeMessages(messages: ChatMessage[]) {
  return messages
    .map((message) => ({
      role: message.role === 'developer' ? 'system' : message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content)
}

function buildPrompt(
  generatorInstance: TextGenerationPipeline,
  messages: ChatMessage[]
) {
  const normalized = normalizeMessages(messages)
  const tokenizer = generatorInstance.tokenizer as {
    apply_chat_template?: (
      conversation: Array<{ role: string; content: string }>,
      options?: { tokenize?: boolean; add_generation_prompt?: boolean }
    ) => string
  } | null

  if (tokenizer?.apply_chat_template) {
    const prompt = tokenizer.apply_chat_template(normalized, {
      tokenize: false,
      add_generation_prompt: true,
    })
    console.debug('[llm.worker] prompt-ready', {
      template: 'yes',
      length: prompt.length,
    })

    return prompt
  }

  const prompt = normalized
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n')
  console.debug('[llm.worker] prompt-ready', {
    template: 'no',
    length: prompt.length,
  })

  return prompt
}

function extractContent(result: unknown) {
  if (!Array.isArray(result) || !result[0]) {
    return ''
  }

  const generated = (result[0] as { generated_text?: unknown }).generated_text

  if (typeof generated === 'string') {
    return generated.trim()
  }

  if (!Array.isArray(generated)) {
    return ''
  }

  const lastMessage = generated[generated.length - 1] as
    | { content?: unknown }
    | undefined

  return typeof lastMessage?.content === 'string'
    ? lastMessage.content.trim()
    : ''
}

let queue = Promise.resolve()

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, id, data } = event.data

  if (type === 'init') {
    let url = data.modelUrl || '/models/'
    if (!url.endsWith('/')) {
      url += '/'
    }
    env.localModelPath = url
    self.postMessage({ type: 'init-ok', id } satisfies WorkerResponse)
    return
  }

  queue = queue
    .then(async () => {
      console.debug('[llm.worker] loading-generator', data.modelName)

      const generatorInstance = await getGenerator(data.modelName, id)
      const prompt = buildPrompt(generatorInstance, data.messages)
      console.debug('[llm.worker] generating', {
        modelName: data.modelName,
        promptLength: prompt.length,
        maxTokens: data.maxTokens || 256,
        temperature: data.temperature ?? 0.2,
      })
      self.postMessage({
        type: 'progress',
        id,
        data: { status: 'generating' },
      } satisfies WorkerResponse)

      const result = await generatorInstance(prompt, {
        max_new_tokens: data.maxTokens || 256,
        temperature: data.temperature ?? 0.2,
        do_sample: (data.temperature ?? 0.2) > 0,
        return_full_text: false,
      } as any)

      const content = extractContent(result)
      console.debug('[llm.worker] result-ready', {
        contentLength: content.length,
        preview: content.slice(0, 120),
      })

      if (data.stream && content) {
        self.postMessage({
          type: 'chunk',
          id,
          data: { chunk: content },
        } satisfies WorkerResponse)
      }

      self.postMessage({
        type: 'result',
        id,
        data: {
          content,
        },
      } satisfies WorkerResponse)
    })
    .catch((error: unknown) => {
      console.error('[llm.worker] generate-error', error)
      self.postMessage({
        type: 'error',
        id,
        error: error instanceof Error ? error.message : String(error),
      } satisfies WorkerResponse)
    })
}
