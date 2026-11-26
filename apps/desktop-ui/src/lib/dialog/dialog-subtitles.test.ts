import { describe, expect, it } from 'vitest'

import {
  buildSubtitlesView,
  SUBTITLES_CONTINUITY_PAUSE_MS,
  SUBTITLES_MAX_SEGMENTS,
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
    hasTranslationModel: true,
    isTranslationOnly: false,
    isActive: true,
    errorText: '',
    labels: {
      waitingForSpeech: 'Listening',
      notRunning: 'Stopped',
      stop: 'Stop',
      expand: 'Expand',
      recording: 'Recording',
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

  it('dims the first phrase while it is still waiting for translation', () => {
    const view = buildSubtitlesView(
      input([segment({ text: 'Hello there', translationState: 'pending' })])
    )
    expect(view.mainText).toBe('')
    expect(view.mainLang).toBeNull()
    expect(view.pendingText).toBe('Hello there')
    expect(view.secondaryText).toBe('')
  })

  it('follows the translation alone with the words still waiting for it', () => {
    const view = buildSubtitlesView(
      input(
        [
          translated,
          segment({ id: 'b', startMs: 200, endMs: 300, text: 'how are you' }),
        ],
        { isTranslationOnly: true }
      )
    )
    expect(view.mainText).toBe('Привет')
    expect(view.pendingText).toBe('how are you')
    expect(view.secondaryText).toBe('')
  })

  it('avoids duplicating trailing untranslated words in secondaryText', () => {
    const view = buildSubtitlesView(
      input(
        [
          translated,
          segment({ id: 'b', startMs: 200, endMs: 300, text: 'how are you' }),
        ],
        { isTranslationOnly: false }
      )
    )
    expect(view.mainText).toBe('Привет')
    expect(view.pendingText).toBe('how are you')
    expect(view.secondaryText).toBe('Hello there')
  })

  it('keeps chronological order when a middle segment failed translation', () => {
    const view = buildSubtitlesView(
      input([
        translated,
        segment({
          id: 'b',
          startMs: 200,
          endMs: 300,
          text: 'my friend',
          translationState: 'failed',
        }),
        segment({
          id: 'c',
          startMs: 400,
          endMs: 500,
          text: 'how are you',
          translation: 'как дела',
          translationState: 'complete',
        }),
      ])
    )
    expect(view.mainText).toBe('Привет my friend как дела')
    expect(view.pendingText).toBe('')
    expect(view.secondaryText).toBe('Hello there my friend how are you')
  })

  it('keeps the previous translation visible across a short pause between turns', () => {
    const view = buildSubtitlesView(
      input([
        translated,
        segment({
          id: 'b',
          startMs: 2500,
          endMs: 2800,
          text: 'because we need tests',
          isFinal: false,
          translationState: 'idle',
        }),
      ])
    )
    expect(view.mainText).toBe('Привет')
    expect(view.pendingText).toBe('because we need tests')
    expect(view.secondaryText).toBe('Hello there')
  })

  it('resets subtitles after a long silence between turns', () => {
    const view = buildSubtitlesView(
      input([
        translated,
        segment({
          id: 'b',
          startMs: 100 + SUBTITLES_CONTINUITY_PAUSE_MS + 100,
          endMs: 100 + SUBTITLES_CONTINUITY_PAUSE_MS + 400,
          text: 'New topic',
          translation: 'Новая тема',
          translationState: 'complete',
        }),
      ])
    )
    expect(view.mainText).toBe('Новая тема')
    expect(view.secondaryText).toBe('New topic')
    expect(view.pendingText).toBe('')
  })

  it('caps the subtitle window to the latest segments', () => {
    const many = Array.from({ length: SUBTITLES_MAX_SEGMENTS + 3 }, (_, i) =>
      segment({
        id: `s-${i}`,
        startMs: i * 500,
        endMs: i * 500 + 200,
        text: `word-${i}`,
        translation: `слово-${i}`,
        translationState: 'complete',
      })
    )
    const view = buildSubtitlesView(input(many))
    expect(view.mainText).not.toContain('слово-0')
    expect(view.mainText).toContain(`слово-${SUBTITLES_MAX_SEGMENTS + 2}`)
  })

  it('shows the original alone without a translation or translation model', () => {
    expect(
      buildSubtitlesView(input([translated], { translationLanguage: '' }))
    ).toMatchObject({
      mainText: 'Hello there',
      pendingText: '',
      secondaryText: '',
    })

    expect(
      buildSubtitlesView(
        input([segment({ text: 'Hello there', translationState: 'idle' })], {
          hasTranslationModel: false,
        })
      )
    ).toMatchObject({
      mainText: 'Hello there',
      pendingText: '',
      secondaryText: '',
    })
  })

  it('puts interim speech in pendingText when translation is off', () => {
    const view = buildSubtitlesView(
      input(
        [
          segment({
            id: 'a',
            startMs: 0,
            endMs: 100,
            text: 'Hello',
            isFinal: true,
          }),
          segment({
            id: 'b',
            startMs: 150,
            endMs: 200,
            text: 'world',
            isFinal: false,
          }),
        ],
        { translationLanguage: '' }
      )
    )
    expect(view.mainText).toBe('Hello')
    expect(view.pendingText).toBe('world')
    expect(view.secondaryText).toBe('')
  })

  it('says whether the dialog listens while nothing was said', () => {
    expect(buildSubtitlesView(input([])).placeholder).toBe('Listening')
    expect(buildSubtitlesView(input([], { isActive: false })).placeholder).toBe(
      'Stopped'
    )
  })
})
