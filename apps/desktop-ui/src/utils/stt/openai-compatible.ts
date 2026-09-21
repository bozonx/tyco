import type { SttModel } from '@tyco/shared'

interface RecordedAudio {
  sampleRate: number
  samples: number[]
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function createWavFile(recording: RecordedAudio) {
  const bytesPerSample = 2
  const dataSize = recording.samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, recording.sampleRate, true)
  view.setUint32(28, recording.sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  recording.samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    view.setInt16(44 + index * bytesPerSample, Math.round(value), true)
  })

  return new File([buffer], 'recording.wav', { type: 'audio/wav' })
}

export async function transcribeOpenAiCompatible(
  model: SttModel,
  recording: RecordedAudio,
  language?: string,
  fetchImpl: typeof fetch = fetch
) {
  const form = new FormData()
  form.append('file', createWavFile(recording))
  form.append('model', model.model)

  if (language) {
    form.append('language', language)
  }

  const response = await fetchImpl(
    `${(model.baseUrl || '').replace(/\/$/, '')}/audio/transcriptions`,
    {
      method: 'POST',
      headers: model.apiKey
        ? { Authorization: `Bearer ${model.apiKey}` }
        : undefined,
      body: form,
    }
  )

  if (!response.ok) {
    throw new Error((await response.text()) || response.statusText)
  }

  const result = (await response.json()) as { text?: unknown }
  return typeof result.text === 'string' ? result.text.trim() : ''
}
