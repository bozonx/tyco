import { desktopClient } from '../../lib/desktop/client'
import { downloadBinaryFile } from '../download/file-download'
import { DESKTOP_COMMANDS, type LlmModelMetadata } from '@shared'

export interface LlmModelDownloadProgress {
  model: string
  file: string
  fileIndex: number
  fileCount: number
  loaded: number
  total: number
  overallProgress: number
  status: 'downloading' | 'saving' | 'done' | 'error'
  error?: string
}

const HF_BASE = 'https://huggingface.co'
const HF_REVISION = 'main'

export const DEFAULT_BROWSER_LLM_MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct'

export const DEFAULT_OLLAMA_MODEL = 'qwen2.5:0.5b'

const QWEN25_FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'merges.txt',
  'vocab.json',
  'added_tokens.json',
  'quantize_config.json',
  'onnx/model_q4.onnx',
]

const SMOLLM2_360M_FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'merges.txt',
  'vocab.json',
  'onnx/model_q4.onnx',
]

const QWEN2_FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'merges.txt',
  'vocab.json',
  'added_tokens.json',
  'quantize_config.json',
  'onnx/model_q4.onnx',
]

export const BROWSER_LLM_MODELS = [
  {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    name: 'Qwen2.5 0.5B Instruct (best RU/multilingual balance)',
  },
  {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    name: 'SmolLM2 360M Instruct (lighter and faster)',
  },
  {
    id: 'onnx-community/Qwen2-0.5B-Instruct-ONNX',
    name: 'Qwen2 0.5B Instruct (older fallback)',
  },
]

export const BROWSER_LLM_MODEL_FILES: Record<string, string[]> = {
  'onnx-community/Qwen2.5-0.5B-Instruct': QWEN25_FILES,
  'HuggingFaceTB/SmolLM2-360M-Instruct': SMOLLM2_360M_FILES,
  'onnx-community/Qwen2-0.5B-Instruct-ONNX': QWEN2_FILES,
}

export function toModelDirName(modelName: string) {
  return modelName.replace(/\//g, '_')
}

export async function isLlmModelDownloaded(
  modelName: string
): Promise<boolean> {
  const result = await desktopClient.invoke<boolean>(
    DESKTOP_COMMANDS.IS_LLM_MODEL_DOWNLOADED,
    { modelName }
  )

  return result.success && result.result === true
}

export async function getLlmModelMetadata(
  modelName: string
): Promise<LlmModelMetadata | null> {
  const result = await desktopClient.invoke<LlmModelMetadata | null>(
    DESKTOP_COMMANDS.GET_LLM_MODEL_METADATA,
    { modelName }
  )

  return result.success ? result.result || null : null
}

async function getLlmModelFileSize(
  modelName: string,
  fileName: string
): Promise<number> {
  const result = await desktopClient.invoke<number | null>(
    DESKTOP_COMMANDS.GET_LLM_MODEL_FILE_SIZE,
    { modelName, fileName }
  )

  return result.success && typeof result.result === 'number' ? result.result : 0
}

export async function hasPartialLlmModelDownload(
  modelName: string
): Promise<boolean> {
  const files = BROWSER_LLM_MODEL_FILES[modelName]

  if (!files) {
    return false
  }

  for (const fileName of files) {
    if ((await getLlmModelFileSize(modelName, fileName)) > 0) {
      return true
    }
  }

  return false
}

export async function downloadLlmModel(
  modelName: string,
  onProgress?: (progress: LlmModelDownloadProgress) => void
): Promise<void> {
  const files = BROWSER_LLM_MODEL_FILES[modelName]

  if (!files) {
    throw new Error(`Unknown browser LLM model: ${modelName}`)
  }

  const fileCount = files.length

  for (const [fileIndex, fileName] of files.entries()) {
    const url = `${HF_BASE}/${modelName}/resolve/${HF_REVISION}/${fileName}`
    const existingSize = await getLlmModelFileSize(modelName, fileName)

    await downloadBinaryFile({
      url,
      fileName,
      existingSize,
      onProgress: (progress) => {
        const currentFileProgress =
          progress.total > 0
            ? Math.min(progress.loaded / progress.total, 1)
            : progress.status === 'done'
              ? 1
              : 0

        onProgress?.({
          model: modelName,
          file: progress.file,
          fileIndex,
          fileCount,
          loaded: progress.loaded,
          total: progress.total,
          overallProgress:
            fileCount > 0
              ? ((fileIndex + currentFileProgress) / fileCount) * 100
              : 0,
          status: progress.status,
        })
      },
      onChunk: async (chunk, append) => {
        const saveResult = await desktopClient.invoke(
          DESKTOP_COMMANDS.SAVE_LLM_MODEL_FILE_CHUNK,
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

  const metadataResult = await desktopClient.invoke<LlmModelMetadata>(
    DESKTOP_COMMANDS.COMPLETE_LLM_MODEL_DOWNLOAD,
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

export async function deleteLlmModel(modelName: string): Promise<void> {
  const result = await desktopClient.invoke(DESKTOP_COMMANDS.DELETE_LLM_MODEL, {
    modelName,
  })

  if (!result.success) {
    throw new Error(`Failed to delete model: ${result.error}`)
  }
}
