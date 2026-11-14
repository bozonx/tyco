import { describe, expect, it } from 'vitest'
import { createCommand } from '../commands/command-config'
import { matchVoiceCatalog } from './voice-catalog'
import type { VoiceCandidate } from './voice-resolver'

const translate = createCommand('core.translate', 'translate')
const note = { ...createCommand('script', 'note'), phrases: ['save note'] }
const candidate = (commandId: string, language?: string): VoiceCandidate => ({
  commandId,
  text: 'Hello',
  parameters: language ? { language } : {},
  consumedWordCount: 1,
  textOffset: 0,
  commandOffset: 0,
})

describe('voice catalog', () => {
  it('marks each command once, with its first candidate', () => {
    const first = candidate('translate', 'es-AR')
    const matches = matchVoiceCatalog(
      [translate, note],
      [
        first,
        candidate('translate', 'es-ES'),
        candidate('note'),
        candidate('missing'),
      ]
    )
    expect([...matches.keys()]).toEqual(['translate', 'note'])
    expect(matches.get('translate')).toBe(first)
  })
})
