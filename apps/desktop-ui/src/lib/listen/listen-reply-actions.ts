import type { QuickAiRequestMenuParams } from '../modals/menu-modal-params'

/** A dictated AI request keeps the listened message as context, not the prompt. */
export function voiceReplyActionParams(
  actionId: string | undefined,
  prompt: string,
  replyTo: string | undefined
): QuickAiRequestMenuParams | undefined {
  if (
    !replyTo ||
    (actionId !== 'quickAiRequest' && actionId !== 'voiceQuickAiRequest')
  )
    return undefined
  return {
    text: replyTo,
    prompt,
    inputMode: actionId === 'voiceQuickAiRequest' ? 'voice' : 'text',
  }
}
