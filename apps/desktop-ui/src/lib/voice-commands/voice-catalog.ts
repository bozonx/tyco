import type { CommandConfig } from '@tyco/shared'
import type { VoiceCandidate } from './voice-resolver'

/** The candidate of each command that the recognizer points at, the first one */
export function matchVoiceCatalog(
  catalog: readonly CommandConfig[],
  candidates: readonly VoiceCandidate[]
): Map<string, VoiceCandidate> {
  const matches = new Map<string, VoiceCandidate>()
  for (const candidate of candidates) {
    if (
      catalog.some((command) => command.id === candidate.commandId) &&
      !matches.has(candidate.commandId)
    )
      matches.set(candidate.commandId, candidate)
  }
  return matches
}
