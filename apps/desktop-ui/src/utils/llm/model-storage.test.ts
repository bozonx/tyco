import { describe, expect, it, vi } from 'vitest'

import {
  BROWSER_LLM_MODEL_FILES,
  downloadLlmModel,
  hasPartialLlmModelDownload,
} from './model-storage'

const { downloadBinaryFileMock, invokeMock } = vi.hoisted(() => ({
  downloadBinaryFileMock: vi.fn(),
  invokeMock: vi.fn(),
}))

vi.mock('../download/file-download', () => ({
  downloadBinaryFile: downloadBinaryFileMock,
}))

vi.mock('../../lib/desktop/client', () => ({
  desktopClient: {
    invoke: invokeMock,
  },
}))

describe('llm model storage', () => {
  it('does not require q4f16 weights for browser-local models', () => {
    expect(
      BROWSER_LLM_MODEL_FILES['onnx-community/Qwen2.5-0.5B-Instruct']
    ).not.toContain('onnx/model_q4f16.onnx')
    expect(
      BROWSER_LLM_MODEL_FILES['HuggingFaceTB/SmolLM2-360M-Instruct']
    ).not.toContain('onnx/model_q4f16.onnx')
    expect(
      BROWSER_LLM_MODEL_FILES['onnx-community/Qwen2-0.5B-Instruct-ONNX']
    ).not.toContain('onnx/model_q4f16.onnx')
  })

  it('detects a partially downloaded model by existing file sizes', async () => {
    invokeMock.mockImplementation(
      async (command: string, args?: { fileName?: string }) => {
        if (
          command === 'get_llm_model_file_size' &&
          args?.fileName === 'tokenizer.json'
        ) {
          return { success: true, result: 128 }
        }

        return { success: true, result: 0 }
      }
    )

    await expect(
      hasPartialLlmModelDownload('onnx-community/Qwen2.5-0.5B-Instruct')
    ).resolves.toBe(true)
  })

  it('reports monotonic overall progress across model files', async () => {
    downloadBinaryFileMock.mockImplementation(
      async ({
        fileName,
        onProgress,
        onChunk,
      }: {
        fileName: string
        onProgress?: (progress: {
          file: string
          loaded: number
          total: number
          status: 'downloading' | 'saving' | 'done' | 'error'
        }) => void
        onChunk: (chunk: Uint8Array, append: boolean) => Promise<void>
      }) => {
        onProgress?.({
          file: fileName,
          loaded: 50,
          total: 100,
          status: 'saving',
        })
        await onChunk(new Uint8Array([1, 2, 3]), false)
        onProgress?.({
          file: fileName,
          loaded: 100,
          total: 100,
          status: 'done',
        })
      }
    )
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_llm_model_file_size') {
        return { success: true, result: 12 }
      }

      return { success: true, result: null }
    })

    const updates: Array<{
      fileIndex: number
      fileCount: number
      overallProgress: number
      status: string
    }> = []

    await downloadLlmModel(
      'onnx-community/Qwen2.5-0.5B-Instruct',
      (progress) => {
        updates.push({
          fileIndex: progress.fileIndex,
          fileCount: progress.fileCount,
          overallProgress: progress.overallProgress,
          status: progress.status,
        })
      }
    )

    const fileCount =
      BROWSER_LLM_MODEL_FILES['onnx-community/Qwen2.5-0.5B-Instruct'].length

    expect(downloadBinaryFileMock).toHaveBeenCalledTimes(fileCount)
    expect(downloadBinaryFileMock.mock.calls[0]?.[0]?.existingSize).toBe(12)
    const firstSaveChunkCall = invokeMock.mock.calls.find(
      (call) => call[0] === 'save_llm_model_file_chunk'
    )
    const lastInvokeCall =
      invokeMock.mock.calls[invokeMock.mock.calls.length - 1]

    expect(lastInvokeCall?.[0]).toBe('complete_llm_model_download')
    expect(lastInvokeCall?.[1]?.files).not.toContain('onnx/model_q4f16.onnx')
    expect(firstSaveChunkCall?.[1]?.data).toBeInstanceOf(Uint8Array)
    expect(updates[0]).toMatchObject({
      fileIndex: 0,
      fileCount,
      overallProgress: 5,
      status: 'saving',
    })
    expect(updates[updates.length - 1]).toMatchObject({
      fileIndex: fileCount - 1,
      fileCount,
      overallProgress: 100,
      status: 'done',
    })

    for (let index = 1; index < updates.length; index += 1) {
      expect(updates[index]!.overallProgress).toBeGreaterThanOrEqual(
        updates[index - 1]!.overallProgress
      )
    }
  })
})
