import { desktopClient } from '../../lib/desktop/client'
import { downloadBinaryFile } from '../download/file-download'
import { DESKTOP_COMMANDS, type WhisperModelMetadata } from '@shared'

export interface ModelDownloadProgress {
  model: string
  file: string
  loaded: number
  total: number
  status: 'downloading' | 'saving' | 'done' | 'error'
  error?: string
}

const HF_BASE = 'https://huggingface.co'
const HF_REVISION = 'main'

const XENOVA_WHISPER_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
]

export const WHISPER_LOCAL_MODELS = [
  { id: 'Xenova/whisper-tiny', name: 'Whisper Tiny (multilingual)' },
  { id: 'Xenova/whisper-base', name: 'Whisper Base (multilingual)' },
  { id: 'Xenova/whisper-small', name: 'Whisper Small (multilingual)' },
  { id: 'Xenova/whisper-medium', name: 'Whisper Medium (multilingual)' },
  { id: 'Xenova/whisper-large-v3', name: 'Whisper Large v3 (multilingual)' },
]

export const DEFAULT_WHISPER_LOCAL_MODEL = WHISPER_LOCAL_MODELS[0]!.id

export const WHISPER_MODEL_FILES: Record<string, string[]> = {
  'Xenova/whisper-tiny': XENOVA_WHISPER_FILES,
  'Xenova/whisper-base': XENOVA_WHISPER_FILES,
  'Xenova/whisper-small': XENOVA_WHISPER_FILES,
  'Xenova/whisper-medium': XENOVA_WHISPER_FILES,
  'Xenova/whisper-large-v3': XENOVA_WHISPER_FILES,
}

export function toModelDirName(modelName: string) {
  return modelName.replace(/\//g, '_')
}

export function toModelFileKey(modelName: string, fileName: string) {
  return `${toModelDirName(modelName)}/${fileName}`
}

export function isOpfsAvailable() {
  return false // Disabled as we use Tauri Rust backend now
}

export async function isModelDownloaded(modelName: string): Promise<boolean> {
  const result = await desktopClient.invoke<boolean>(
    DESKTOP_COMMANDS.IS_WHISPER_MODEL_DOWNLOADED,
    { modelName }
  )
  return result.success && result.result === true
}

export async function getModelMetadata(
  modelName: string
): Promise<WhisperModelMetadata | null> {
  const result = await desktopClient.invoke<WhisperModelMetadata | null>(
    DESKTOP_COMMANDS.GET_WHISPER_MODEL_METADATA,
    { modelName }
  )

  return result.success ? result.result || null : null
}

async function getWhisperModelFileSize(
  modelName: string,
  fileName: string
): Promise<number> {
  const result = await desktopClient.invoke<number | null>(
    DESKTOP_COMMANDS.GET_WHISPER_MODEL_FILE_SIZE,
    { modelName, fileName }
  )

  return result.success && typeof result.result === 'number' ? result.result : 0
}

export async function hasPartialWhisperModelDownload(
  modelName: string
): Promise<boolean> {
  const files = WHISPER_MODEL_FILES[modelName]

  if (!files) {
    return false
  }

  for (const fileName of files) {
    if ((await getWhisperModelFileSize(modelName, fileName)) > 0) {
      return true
    }
  }

  return false
}

export async function downloadModel(
  modelName: string,
  onProgress?: (progress: ModelDownloadProgress) => void
): Promise<void> {
  const files = WHISPER_MODEL_FILES[modelName]

  if (!files) {
    throw new Error(`Unknown Whisper model: ${modelName}`)
  }

  for (const fileName of files) {
    const url = `${HF_BASE}/${modelName}/resolve/${HF_REVISION}/${fileName}`
    const existingSize = await getWhisperModelFileSize(modelName, fileName)

    await downloadBinaryFile({
      url,
      fileName,
      existingSize,
      onProgress: (progress) => {
        onProgress?.({
          model: modelName,
          file: progress.file,
          loaded: progress.loaded,
          total: progress.total,
          status: progress.status,
        })
      },
      onChunk: async (chunk, append) => {
        const saveResult = await desktopClient.invoke(
          DESKTOP_COMMANDS.SAVE_WHISPER_MODEL_FILE_CHUNK,
          {
            modelName,
            fileName,
            // Avoid duplicating every chunk into a plain JS array before IPC.
            data: chunk,
            append,
          }
        )

        if (!saveResult.success) {
          throw new Error(`Failed to save ${fileName}: ${saveResult.error}`)
        }
      },
    })
  }

  const metadataResult = await desktopClient.invoke<WhisperModelMetadata>(
    DESKTOP_COMMANDS.COMPLETE_WHISPER_MODEL_DOWNLOAD,
    {
      modelName,
      version: HF_REVISION,
      files,
    }
  )

  if (!metadataResult.success) {
    throw new Error(
      `Failed to complete model metadata: ${metadataResult.error}`
    )
  }
}

export async function deleteModel(modelName: string): Promise<void> {
  const result = await desktopClient.invoke(
    DESKTOP_COMMANDS.DELETE_WHISPER_MODEL,
    {
      modelName,
    }
  )

  if (!result.success) {
    throw new Error(`Failed to delete model: ${result.error}`)
  }
}
