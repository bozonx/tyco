import { desktopClient } from '../../lib/desktop/client'
import LlmWorker from '../../workers/llm.worker.ts?worker'
import { DEFAULT_BROWSER_LLM_MODEL, isLlmModelDownloaded } from './model-storage'
import type { WorkerResponse } from './worker-protocol'
import type { ChatMessage, LlmModel } from '@shared'
import { DESKTOP_COMMANDS } from '@shared'
import { convertFileSrc } from '@tauri-apps/api/core'

export interface BrowserLocalLlmProgress {
  status: string
  file?: string
  progress?: number
}

let worker: Worker | null = null
let workerInitialized = false

function createAbortError() {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function resetWorker() {
  if (worker) {
    worker.terminate()
  }

  worker = null
  workerInitialized = false
}

function getWorker() {
  if (!worker) {
    worker = new LlmWorker()
    workerInitialized = false
  }

  return worker
}

async function ensureWorkerInitialized() {
  if (workerInitialized) {
    return
  }

  const result = await desktopClient.invoke<string>(
    DESKTOP_COMMANDS.GET_LLM_MODEL_PATH,
    {
      modelName: '',
      fileName: '',
    }
  )

  let modelPath =
    result.success && typeof result.result === 'string' ? result.result : ''
  if (modelPath.endsWith('/')) {
    modelPath = modelPath.slice(0, -1)
  }

  const modelUrl = modelPath ? convertFileSrc(modelPath) : ''
  const activeWorker = getWorker()
  const id = Math.random()

  await new Promise<void>((resolve, reject) => {
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) {
        return
      }

      activeWorker.removeEventListener('message', handleMessage)

      if (event.data.type === 'init-ok') {
        workerInitialized = true
        resolve()
        return
      }

      if (event.data.type === 'error') {
        reject(new Error(event.data.error))
        return
      }

      reject(new Error('Worker init failed'))
    }

    activeWorker.addEventListener('message', handleMessage)
    activeWorker.postMessage({ type: 'init', id, data: { modelUrl } })
  })
}

export async function runBrowserLocalChatCompletion(
  model: LlmModel,
  messages: ChatMessage[],
  options?: {
    onChunk?: (chunk: string) => void
    signal?: AbortSignal
    onProgress?: (progress: BrowserLocalLlmProgress) => void
  }
) {
  const modelName = model.localModel || model.model || DEFAULT_BROWSER_LLM_MODEL
  const maxTokens = Math.min(model.maxTokens ?? 256, 64)
  const downloaded = await isLlmModelDownloaded(modelName)

  if (!downloaded) {
    throw new Error(`Browser LLM model is not downloaded: ${modelName}`)
  }

  await ensureWorkerInitialized()
  const activeWorker = getWorker()
  const id = Math.random()

  return await new Promise<{ content: string }>((resolve, reject) => {
    const handleMessage = (
      event: MessageEvent<
        WorkerResponse | { type: 'chunk'; id: number; data: { chunk: string } }
      >
    ) => {
      if (event.data.id !== id) {
        return
      }

      if (event.data.type === 'progress') {
        options?.onProgress?.(event.data.data)
        return
      }

      if (event.data.type === 'chunk') {
        options?.onChunk?.(event.data.data.chunk)
        return
      }

      if (event.data.type === 'result') {
        activeWorker.removeEventListener('message', handleMessage)
        options?.signal?.removeEventListener('abort', abortHandler)
        resolve(event.data.data)
        return
      }

      if (event.data.type === 'aborted') {
        activeWorker.removeEventListener('message', handleMessage)
        options?.signal?.removeEventListener('abort', abortHandler)
        reject(createAbortError())
        return
      }

      if (event.data.type === 'error') {
        activeWorker.removeEventListener('message', handleMessage)
        options?.signal?.removeEventListener('abort', abortHandler)
        reject(new Error(event.data.error))
        return
      }
    }

    const abortHandler = () => {
      activeWorker.removeEventListener('message', handleMessage)
      options?.signal?.removeEventListener('abort', abortHandler)
      resetWorker()
      reject(createAbortError())
    }

    if (options?.signal) {
      options.signal.addEventListener('abort', abortHandler)
      if (options.signal.aborted) {
        abortHandler()
        return
      }
    }

    activeWorker.addEventListener('message', handleMessage)
    activeWorker.postMessage({
      type: 'generate',
      id,
      data: {
        modelName,
        messages,
        temperature: model.temperature ?? 0.2,
        maxTokens,
        stream: !!options?.onChunk,
      },
    })
  })
}
