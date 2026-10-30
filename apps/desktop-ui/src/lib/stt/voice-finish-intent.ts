/**
 * What to do with the dictated text: `insert` puts it into the input, `submit`
 * also sends it where the input supports that, `next` opens the step with the
 * actions for the text.
 */
export type VoiceFinishIntent = 'insert' | 'submit' | 'next' | 'copy'

/** Default completion behavior and available shortcuts of a voice input. */
export type VoiceFinishBehavior =
  'submitToChat' | 'insertIntoTarget' | 'confirm'
