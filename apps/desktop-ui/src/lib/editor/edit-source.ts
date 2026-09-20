/**
 * Where a programmatic document edit came from. The source is put on the
 * CodeMirror transaction as a `userEvent` and decides whether the edit is
 * merged with its neighbours in the undo history
 */
export type EditSource = 'plain' | 'ai' | 'voice' | 'paste'

/**
 * `userEvent` values for transactions — they identify an edit in logs and in
 * tests.
 *
 * All of them stay under the standard `input` root so that extensions testing
 * `tr.isUserEvent('input')` (the upcoming spellchecker among them) still see
 * these edits. History only merges `input.type*` and `delete*`, so the custom
 * suffixes remain separate undo steps
 */
export const EDIT_USER_EVENT: Record<EditSource, string> = {
  plain: 'input.tyco.store',
  ai: 'input.tyco.ai',
  voice: 'input.tyco.voice',
  paste: 'input.paste',
}

/**
 * Sources that must be their own Ctrl+Z step: the result of an AI
 * transformation or recognized speech is not merged with manual typing
 */
export const isolatedEditSources: ReadonlySet<EditSource> = new Set<EditSource>(
  ['ai', 'voice', 'paste']
)
