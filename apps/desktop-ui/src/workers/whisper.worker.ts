import {
  type AutomaticSpeechRecognitionPipeline,
  env,
  pipeline,
} from '@huggingface/transformers'

type WorkerMessage =
  | {
      type: 'init'
      id: number
      data: { modelUrl: string }
    }
  | {
      type: 'transcribe'
      id: number
      data: {
        audio: Float32Array
        modelName: string
        language?: string
      }
    }

type WorkerResponse =
  | { type: 'init-ok'; id: number }
  | { type: 'progress'; id: number; data: { progress: number } }
  | { type: 'result'; id: number; data: unknown }
  | { type: 'error'; id: number; error: string }

env.allowRemoteModels = false
env.allowLocalModels = true
env.useBrowserCache = false

let transcriber: AutomaticSpeechRecognitionPipeline | null = null
let currentModelName: string | null = null
let isWebGpuAvailable: boolean | null = null

function toModelDirName(modelName: string) {
  return modelName.replace(/\//g, '_')
}

async function hasWebGpu() {
  if (isWebGpuAvailable !== null) {
    return isWebGpuAvailable
  }

  try {
    const gpu = (self.navigator as Navigator & { gpu?: GPU }).gpu
    isWebGpuAvailable = Boolean(gpu && (await gpu.requestAdapter()))
  } catch {
    isWebGpuAvailable = false
  }

  return isWebGpuAvailable
}

async function getTranscriber(modelName: string) {
  if (transcriber && currentModelName === modelName) {
    return transcriber
  }

  currentModelName = modelName
  const localModelName = toModelDirName(modelName)

  if (await hasWebGpu()) {
    try {
      env.backends.onnx.gpu = true
      transcriber = (await pipeline(
        'automatic-speech-recognition',
        localModelName,
        {
          device: 'webgpu',
          quantized: true,
        } as any
      )) as AutomaticSpeechRecognitionPipeline

      return transcriber
    } catch {
      isWebGpuAvailable = false
      transcriber = null
    }
  }

  env.backends.onnx.gpu = false
  transcriber = (await pipeline(
    'automatic-speech-recognition',
    localModelName,
    {
      device: 'wasm',
      quantized: true,
    } as any
  )) as AutomaticSpeechRecognitionPipeline

  return transcriber
}

let queue = Promise.resolve()

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, id, data } = event.data

  if (type === 'init') {
    // Configure local model path from main thread's asset protocol url
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
      const transcriberInstance = await getTranscriber(data.modelName)
      const result = await transcriberInstance(data.audio, {
        language: data.language || undefined,
        subtask: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        progress_callback: (progress: { progress?: number }) => {
          self.postMessage({
            type: 'progress',
            id,
            data: { progress: progress.progress || 0 },
          } satisfies WorkerResponse)
        },
      } as any)

      self.postMessage({
        type: 'result',
        id,
        data: result,
      } satisfies WorkerResponse)
    })
    .catch((error: unknown) => {
      self.postMessage({
        type: 'error',
        id,
        error: error instanceof Error ? error.message : String(error),
      } satisfies WorkerResponse)
    })
}
