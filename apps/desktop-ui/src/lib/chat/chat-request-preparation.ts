import type { ChatAttachment, ChatImage } from '@tyco/shared'
import { trimChatContext } from './chat-helpers'
import { imageBudgetCharacters, MAX_CHAT_IMAGES } from './chat-image-input'
import type { ChatStoreDeps } from './chat-store-contracts'
import type { ChatState } from './chat-state'
/** The same text attached twice goes once, with the source it came first */
const uniqueAttachments = (attachments: ChatAttachment[]) =>
  attachments.filter(
    (item, index) =>
      attachments.findIndex(
        (other) => other.text === item.text && other.name === item.name
      ) === index
  )

export function prepareGenerationRequest(
  deps: Pick<
    ChatStoreDeps,
    | 'getChatModel'
    | 'notifyError'
    | 'noModelError'
    | 'imageModelError'
    | 'messageTooLongError'
    | 'imageOmittedText'
  >,
  state: Pick<ChatState, 'messages' | 'lastFailedTurn' | 'omitHistoryImages'>,
  message: string,
  attachments: ChatAttachment[],
  images: ChatImage[]
) {
  const { messages, lastFailedTurn, omitHistoryImages } = state
  const model = deps.getChatModel()
  if (!model) {
    deps.notifyError(deps.noModelError())
    return null
  }

  if (
    images.length > MAX_CHAT_IMAGES ||
    (images.length > 0 && !model.canUseImages)
  ) {
    deps.notifyError(deps.imageModelError?.() || deps.noModelError())
    return null
  }

  const failed = lastFailedTurn.value
  const retrying = Boolean(
    failed?.message === message &&
    JSON.stringify(failed.images || []) === JSON.stringify(images) &&
    messages.value.at(-1)?.role === 'user' &&
    messages.value.at(-1)?.content === message
  )
  if (retrying) {
    // the context of the failed turn goes with it again
    attachments = uniqueAttachments([
      ...(failed?.attachments || []),
      ...attachments,
    ])
  }

  const inputSize =
    images.reduce((sum, image) => sum + imageBudgetCharacters(image), 0) +
    message.length +
    attachments.reduce((sum, item) => sum + item.text.length, 0)
  if (inputSize > model.budgetCharacters) {
    deps.notifyError(deps.messageTooLongError())
    return null
  }

  const history = retrying ? messages.value.slice(0, -1) : messages.value
  const requestHistory = omitHistoryImages.value
    ? history.map((item) =>
        item.images?.length
          ? {
              ...item,
              images: [],
              content: [
                item.content,
                deps.imageOmittedText?.() || '[Images omitted]',
              ]
                .filter(Boolean)
                .join('\n\n'),
            }
          : item
      )
    : history
  const prevMessages = trimChatContext(
    requestHistory,
    Math.max(0, model.budgetCharacters - inputSize)
  )
  if (!model.canUseImages && prevMessages.some((item) => item.images?.length)) {
    deps.notifyError(deps.imageModelError?.() || deps.noModelError())
    return null
  }
  const trimmedTurns =
    requestHistory.filter((item) => item.role === 'user').length -
    prevMessages.filter((item) => item.role === 'user').length
  return { model, attachments, retrying, prevMessages, trimmedTurns }
}
