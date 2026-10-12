import { needsGeneratedTitle } from './chat-title'
import type { ChatStoreDeps } from './chat-store-contracts'
import type { ChatState } from './chat-state'
export function createChatTitleController(
  deps: Pick<
    ChatStoreDeps,
    'generateChatTitle' | 'renameChat' | 'isHistoryEnabled'
  >,
  state: Pick<ChatState, 'messages' | 'newChatParams'>
) {
  const { messages, newChatParams } = state
  let titleController: AbortController | undefined
  const currentTitle = () => newChatParams.value.title || ''
  const cancel = () => {
    titleController?.abort()
    titleController = undefined
  }
  const maybeGenerateTitle = async (modelId: string) => {
    const id = newChatParams.value.id
    const title = currentTitle()
    if (deps.isHistoryEnabled?.() === false) return
    if (!id || !needsGeneratedTitle(messages.value, title)) return

    const [question, answer] = messages.value
    titleController?.abort()
    const controller = new AbortController()
    titleController = controller
    let generated: string
    try {
      generated = await deps.generateChatTitle(
        question.content,
        answer.content,
        modelId,
        controller.signal
      )
    } catch {
      // the draft title stays
      return
    } finally {
      if (titleController === controller) titleController = undefined
    }
    if (!generated || controller.signal.aborted) return

    const isCurrent = newChatParams.value.id === id
    // renamed meanwhile, by the user or in another way
    if (isCurrent && currentTitle() !== title) return
    if (isCurrent) newChatParams.value.title = generated
    try {
      await deps.renameChat(id, generated)
    } catch {
      // the dependency reports it; the chat keeps working
    }
  }

  return { maybeGenerateTitle, cancel }
}
