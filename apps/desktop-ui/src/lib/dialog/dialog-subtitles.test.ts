import { describe, expect, it } from 'vitest'

import {
  buildSubtitlesView,
  type DialogSubtitlesInput,
} from './dialog-subtitles'
import { buildDialogTurns, type DialogSegment } from './dialog-transcript'

function segment(patch: Partial<DialogSegment>): DialogSegment {
  return {
    id: 'a',
    side: 'remote',
    startMs: 0,
    endMs: 100,
    text: 'Hello there',
    isFinal: true,
    translationState: 'idle',
    ...patch,
  }
}

function input(
  segments: DialogSegment[],
  patch: Partial<DialogSubtitlesInput> = {}
): DialogSubtitlesInput {
  return {
    turns: buildDialogTurns(segments),
    translationLanguage: 'ru-RU',
    textDisplay: 'both',
    isActive: true,
    errorText: '',
    labels: {
      waitingForSpeech: 'Listening',
      notRunning: 'Stopped',
      stop: 'Stop',
      expand: 'Expand',
    },
    ...patch,
  }
}

const translated = segment({
  translation: 'Привет',
  translationState: 'complete',
})

describe('buildSubtitlesView', () => {
  it('shows the translation large and the original under it', () => {
    const view = buildSubtitlesView(input([translated]))
    expect(view.mainText).toBe('Привет')
    expect(view.mainLang).toBe('ru-RU')
    expect(view.secondaryText).toBe('Hello there')
    expect(view.pendingText).toBe('')
  })

  it('follows the translation alone with the words still waiting for it', () => {
    const view = buildSubtitlesView(
      input(
        [
          translated,
          segment({ id: 'b', startMs: 200, endMs: 300, text: 'how are you' }),
        ],
        { textDisplay: 'translation' }
      )
    )
    expect(view.mainText).toBe('Привет')
    expect(view.pendingText).toBe('how are you')
    expect(view.secondaryText).toBe('')
  })

  it('shows the original without a translation or when asked to', () => {
    expect(
      buildSubtitlesView(input([translated], { textDisplay: 'original' }))
    ).toMatchObject({ mainText: 'Hello there', mainLang: null })
    expect(
      buildSubtitlesView(input([translated], { translationLanguage: '' }))
    ).toMatchObject({ mainText: 'Hello there', secondaryText: '' })
  })

  it('says whether the dialog listens while nothing was said', () => {
    expect(buildSubtitlesView(input([])).placeholder).toBe('Listening')
    expect(buildSubtitlesView(input([], { isActive: false })).placeholder).toBe(
      'Stopped'
    )
  })
})
