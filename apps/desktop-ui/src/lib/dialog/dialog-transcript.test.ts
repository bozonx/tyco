import { describe, expect, it } from 'vitest'

import {
  buildDialogFeedItems,
  buildDialogTurns,
  createDialogTranscript,
  lastRemoteTurn,
  turnText,
  turnTranslation,
  turnUntranslatedText,
  type DialogSegment,
  type DialogSessionBreak,
  type DialogSide,
} from './dialog-transcript'

function segment(
  id: string,
  side: DialogSide,
  startMs: number,
  endMs: number
): DialogSegment {
  return {
    id,
    side,
    startMs,
    endMs,
    text: id,
    isFinal: true,
    translationState: 'idle',
  }
}

function ids(segments: DialogSegment[]) {
  return buildDialogTurns(segments).map((turn) =>
    turn.segments.map((item) => item.id)
  )
}

describe('buildDialogTurns', () => {
  it('groups nearby speech and separates pauses and speaker changes', () => {
    expect(
      ids([
        segment('a', 'remote', 0, 100),
        segment('b', 'remote', 200, 300),
        segment('c', 'me', 400, 500),
        segment('d', 'remote', 600, 700),
        segment('e', 'remote', 3000, 4000),
      ])
    ).toEqual([['a', 'b'], ['c'], ['d'], ['e']])
  })

  it('keeps overlapping turns open and sorts by start time', () => {
    expect(
      ids([
        segment('c', 'remote', 600, 900),
        segment('b', 'me', 300, 700),
        segment('a', 'remote', 0, 800),
      ])
    ).toEqual([['a', 'c'], ['b']])
  })

  it('names a turn by its first segment and joins its texts', () => {
    const [turn] = buildDialogTurns([
      { ...segment('a', 'remote', 0, 100), translation: 'A' },
      { ...segment('b', 'remote', 200, 300), translation: 'B' },
    ])
    expect(turn.id).toBe('a')
    expect(turnText(turn)).toBe('a b')
    expect(turnTranslation(turn)).toBe('A B')
  })

  it('tells what of a turn waits for its translation', () => {
    const [turn] = buildDialogTurns([
      {
        ...segment('a', 'remote', 0, 100),
        translation: 'A',
        translationState: 'complete',
      },
      { ...segment('b', 'remote', 200, 300), translationState: 'pending' },
    ])
    expect(turnUntranslatedText(turn)).toBe('b')
  })

  it('finds the latest turn of the other side', () => {
    const turns = buildDialogTurns([
      segment('a', 'remote', 0, 100),
      segment('b', 'me', 200, 300),
    ])
    expect(lastRemoteTurn(turns)?.id).toBe('a')
    expect(lastRemoteTurn([])).toBeUndefined()
  })
})

describe('createDialogTranscript', () => {
  function transcript() {
    let next = 0
    const changes: (readonly DialogSegment[])[] = []
    const model = createDialogTranscript({
      createId: () => `s${(next += 1)}`,
      onChange: (segments) => changes.push(segments),
    })
    return { model, changes }
  }

  it('replaces the guess of a side and settles it with a final part', () => {
    const { model } = transcript()
    model.apply('remote', { type: 'partial', text: 'hel', startMs: 0 }, 1000)
    model.apply('remote', { type: 'partial', text: 'hello', startMs: 0 }, 1000)
    model.apply('me', { type: 'partial', text: 'yes', startMs: 50 }, 0)
    expect(model.segments.map((item) => [item.text, item.isFinal])).toEqual([
      ['hello', false],
      ['yes', false],
    ])
    const settled = model.apply(
      'remote',
      { type: 'final', segment: { text: ' hello ', startMs: 0, endMs: 400 } },
      1000
    )
    expect(settled).toMatchObject({
      side: 'remote',
      text: 'hello',
      isFinal: true,
      startMs: 1000,
      endMs: 1400,
    })
    expect(model.segments.map((item) => item.text)).toEqual(['yes', 'hello'])
  })

  it('keeps a stable segment id across partial updates and finalization', () => {
    const { model } = transcript()
    model.apply('remote', { type: 'partial', text: 'hel', startMs: 0 }, 1000)
    const firstDraftId = model.segments[0].id
    model.apply('remote', { type: 'partial', text: 'hello', startMs: 0 }, 1000)
    expect(model.segments[0].id).toBe(firstDraftId)
    const settled = model.apply(
      'remote',
      {
        type: 'final',
        segment: { text: 'hello world', startMs: 0, endMs: 500 },
      },
      1000
    )
    expect(settled?.id).toBe(firstDraftId)
  })

  it('drops an empty guess and a lost one', () => {
    const { model } = transcript()
    model.apply('me', { type: 'partial', text: 'um', startMs: 0 }, 0)
    model.apply('me', { type: 'partial', text: ' ', startMs: 0 }, 0)
    expect(model.segments).toEqual([])
    model.apply('me', { type: 'partial', text: 'so', startMs: 0 }, 0)
    model.dropDraft('me')
    expect(model.segments).toEqual([])
  })

  it('updates the translation of a segment and clears everything', () => {
    const { model, changes } = transcript()
    const settled = model.apply(
      'remote',
      { type: 'final', segment: { text: 'hi', startMs: 0, endMs: 10 } },
      0
    )!
    model.update(settled.id, {
      translation: 'привет',
      translationState: 'complete',
    })
    expect(model.segments[0]).toMatchObject({
      translation: 'привет',
      translationState: 'complete',
    })
    model.update('missing', { translationState: 'failed' })
    model.clear()
    expect(model.segments).toEqual([])
    expect(changes).toHaveLength(3)
  })
})

describe('buildDialogFeedItems', () => {
  it('places session break before turn when starting at the exact same millisecond', () => {
    const turns = buildDialogTurns([segment('a', 'me', 1000, 2000)])
    const breaks: DialogSessionBreak[] = [
      {
        id: 'break-1',
        timestampMs: 1000,
        isRecording: false,
        action: 'started',
      },
    ]

    const items = buildDialogFeedItems(turns, breaks)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ type: 'break', sessionBreak: breaks[0] })
    expect(items[1]).toEqual({ type: 'turn', turn: turns[0] })
  })

  it('guarantees the first break is placed before the first turn even if timestamp was later', () => {
    const turns = buildDialogTurns([segment('a', 'me', 1000, 2000)])
    const breaks: DialogSessionBreak[] = [
      {
        id: 'break-1',
        timestampMs: 1050,
        isRecording: false,
        action: 'started',
      },
    ]

    const items = buildDialogFeedItems(turns, breaks)
    expect(items).toHaveLength(2)
    expect(items[0].type).toBe('break')
    expect(items[1].type).toBe('turn')
  })
})
