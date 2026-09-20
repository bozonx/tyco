import { desktopClient } from '../../lib/desktop/client'
import WhisperWorker from '../../workers/whisper.worker.ts?worker'
import { isModelDownloaded } from './model-storage'
import { DESKTOP_COMMANDS } from '@shared'
import { convertFileSrc } from '@tauri-apps/api/core'

interface BrowserWhisperOptions {
  modelName: string
  language?: string
  restorePunctuation?: boolean
  onText?: (text: string) => void
  startRecording?: () => Promise<void>
  stopRecording?: () => Promise<{ sampleRate: number; samples: number[] }>
}

type WorkerResponse =
  | { type: 'init-ok'; id: number }
  | { type: 'progress'; id: number; data: { progress: number } }
  | { type: 'result'; id: number; data: unknown }
  | { type: 'error'; id: number; error: string }

let worker: Worker | null = null
let workerInitialized = false
let currentOptions: BrowserWhisperOptions | null = null
let stopPromise: Promise<string> | null = null
let shouldTranscribeOnStop = true

function getWorker() {
  if (!worker) {
    worker = new WhisperWorker()
    workerInitialized = false
  }

  return worker
}

async function ensureWorkerInitialized() {
  if (workerInitialized) {
    return
  }

  const result = await desktopClient.invoke<string>(
    DESKTOP_COMMANDS.GET_WHISPER_MODEL_PATH,
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

      reject(
        new Error(
          event.data.type === 'error' ? event.data.error : 'Worker init failed'
        )
      )
    }

    activeWorker.addEventListener('message', handleMessage)
    activeWorker.postMessage({ type: 'init', id, data: { modelUrl } })
  })
}

function extractText(result: unknown) {
  if (!result || typeof result !== 'object') {
    return ''
  }

  const maybeText = (result as { text?: unknown }).text

  return typeof maybeText === 'string' ? maybeText.trim() : ''
}

function maybeStripPunctuation(text: string, restorePunctuation = true) {
  if (restorePunctuation) {
    return text
  }

  return text
    .replace(/\p{P}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function decodeToMono16k(blob: Blob) {
  const audioContext = new AudioContext()

  try {
    const audioBuffer = await audioContext.decodeAudioData(
      await blob.arrayBuffer()
    )
    const sourceRate = audioBuffer.sampleRate
    const source = audioBuffer.getChannelData(0)

    if (sourceRate === 16000) {
      return new Float32Array(source)
    }

    const targetLength = Math.max(
      1,
      Math.round((source.length * 16000) / sourceRate)
    )
    const target = new Float32Array(targetLength)

    for (let i = 0; i < targetLength; i += 1) {
      const sourceIndex = (i * sourceRate) / 16000
      const leftIndex = Math.floor(sourceIndex)
      const rightIndex = Math.min(source.length - 1, leftIndex + 1)
      const mix = sourceIndex - leftIndex
      target[i] = source[leftIndex]! * (1 - mix) + source[rightIndex]! * mix
    }

    return target
  } finally {
    await audioContext.close()
  }
}

function resampleTo16k(source: Float32Array, sourceRate: number) {
  if (sourceRate === 16000) {
    return source
  }

  const targetLength = Math.max(
    1,
    Math.round((source.length * 16000) / sourceRate)
  )
  const target = new Float32Array(targetLength)

  for (let i = 0; i < targetLength; i += 1) {
    const sourceIndex = (i * sourceRate) / 16000
    const leftIndex = Math.floor(sourceIndex)
    const rightIndex = Math.min(source.length - 1, leftIndex + 1)
    const mix = sourceIndex - leftIndex
    target[i] = source[leftIndex]! * (1 - mix) + source[rightIndex]! * mix
  }

  return target
}

async function transcribeAudio(
  audio: Float32Array,
  options: BrowserWhisperOptions
) {
  const downloaded = await isModelDownloaded(options.modelName)

  if (!downloaded) {
    throw new Error(`Whisper model is not downloaded: ${options.modelName}`)
  }

  await ensureWorkerInitialized()
  const activeWorker = getWorker()
  const id = Math.random()

  return await new Promise<string>((resolve, reject) => {
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) {
        return
      }

      if (event.data.type === 'result') {
        activeWorker.removeEventListener('message', handleMessage)
        const text = maybeStripPunctuation(
          extractText(event.data.data),
          options.restorePunctuation !== false
        )
        options.onText?.(text)
        resolve(text)
      } else if (event.data.type === 'error') {
        activeWorker.removeEventListener('message', handleMessage)
        reject(new Error(event.data.error))
      }
    }

    activeWorker.addEventListener('message', handleMessage)
    activeWorker.postMessage(
      {
        type: 'transcribe',
        id,
        data: {
          audio,
          modelName: options.modelName,
          language: options.language?.trim() || undefined,
        },
      },
      [audio.buffer]
    )
  })
}

export async function startBrowserWhisperRecognition(
  options: BrowserWhisperOptions
) {
  if (currentOptions) {
    return
  }

  const downloaded = await isModelDownloaded(options.modelName)

  if (!downloaded) {
    throw new Error(`Whisper model is not downloaded: ${options.modelName}`)
  }

  currentOptions = options
  stopPromise = null
  shouldTranscribeOnStop = true

  if (options.startRecording) {
    try {
      await options.startRecording()
    } catch (error) {
      currentOptions = null
      throw error
    }
    return
  }

  const mediaStream = await navigator.mediaDevices
    .getUserMedia({ audio: true })
    .catch((error) => {
      currentOptions = null
      throw error
    })
  const chunks: BlobPart[] = []
  const mediaRecorder = new MediaRecorder(mediaStream)

  currentOptions = {
    ...options,
    stopRecording: async () =>
      await new Promise((resolve, reject) => {
        mediaRecorder.addEventListener(
          'stop',
          () => {
            mediaStream.getTracks().forEach((track) => track.stop())
            const blob = new Blob(chunks, {
              type: mediaRecorder.mimeType || 'audio/webm',
            })
            void decodeToMono16k(blob).then(
              (samples) =>
                resolve({ sampleRate: 16000, samples: Array.from(samples) }),
              reject
            )
          },
          { once: true }
        )
        mediaRecorder.stop()
      }),
  }

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  })
  mediaRecorder.start()
}

export async function stopBrowserWhisperRecognition() {
  if (stopPromise) {
    return await stopPromise
  }

  if (!currentOptions) {
    return ''
  }

  stopPromise = new Promise<string>((resolve, reject) => {
    const options = currentOptions
    if (!options?.stopRecording) {
      resolve('')
      return
    }

    void options
      .stopRecording()
      .then(({ sampleRate, samples }) => {
        if (!shouldTranscribeOnStop) {
          resolve('')
          return
        }

        const audio = resampleTo16k(Float32Array.from(samples), sampleRate)
        void transcribeAudio(audio, options).then(resolve, reject)
      })
      .catch(reject)
  }).finally(() => {
    stopPromise = null
    currentOptions = null
  })

  return await stopPromise
}

export async function cancelBrowserWhisperRecognition() {
  shouldTranscribeOnStop = false
  return await stopBrowserWhisperRecognition()
}
