import {
  DESKTOP_EVENTS,
  type DesktopEventPayloads,
  type ChatParams,
  type DesktopListen,
} from '@tyco/shared'

import { createCleanupScope } from './cleanup-scope'

type EventPayload<K extends keyof DesktopEventPayloads> =
  DesktopEventPayloads[K]

export interface AppWindowControllerDependencies {
  isQuickWindow: boolean
  listen: DesktopListen
  reportError: (error: unknown) => void
  startBootstrap: () => Promise<void>
  stopBootstrap: () => void
  startMetrics: () => Promise<void>
  stopMetrics: () => void
  disposePlugins: () => Promise<void>
  refreshPlugins: () => Promise<void>
  /** Another device changed the settings this one has just saved */
  notifySettingsConflict: () => void
  notifyScreenshotFailed?: () => void
  shutdown: {
    request: (requestId: number) => Promise<void>
    cancel: () => void
    dispose: () => void
  }
  runSelection: (
    payload: EventPayload<typeof DESKTOP_EVENTS.SELECTION_RUN>
  ) => Promise<unknown>
  cancelSelection: (runId: number) => void
  runCommand: (
    payload: EventPayload<typeof DESKTOP_EVENTS.COMMAND_RUN>
  ) => Promise<unknown>
  cancelCommand: (id: string) => void
  closeModals: () => void
  goToChat: () => Promise<void>
  goToProfileChat?: (profileId: string) => Promise<void>
  profileChat?: (profileId: string) => {
    startChat: (params: ChatParams) => Promise<void>
    openLastChat: () => Promise<void>
    openChat: (id: string) => Promise<boolean | void>
    setChatInput: (text: string) => void
    sendChatInput: () => Promise<unknown>
    focusChatInput: () => void
  }
  startChat: (params: ChatParams) => Promise<void>
  openLastChat: () => Promise<void>
  openChat: (id: string) => Promise<boolean | void>
  afterRender: () => Promise<void>
  setChatInput: (text: string) => void
  sendChatInput: () => Promise<unknown>
  focusChatInput: () => void
  applyEditorTransfer: (text?: string, sourceText?: string) => unknown
  goToEditor: () => Promise<void>
  resetMainWindow: () => Promise<void>
}

/** Owns desktop event subscriptions and routes each operation to its window. */
export function createAppWindowController(
  deps: AppWindowControllerDependencies
) {
  const scope = createCleanupScope()
  let starting: Promise<void> | undefined
  let chatRequest = 0

  /** The chat of the profile, else the Ask AI one */
  async function goToChatOf(profileId: string | null | undefined) {
    if (profileId && deps.goToProfileChat) await deps.goToProfileChat(profileId)
    else await deps.goToChat()
    const profile =
      profileId && deps.profileChat ? deps.profileChat(profileId) : null
    return (
      profile ?? {
        startChat: deps.startChat,
        openLastChat: deps.openLastChat,
        openChat: deps.openChat,
        setChatInput: deps.setChatInput,
        sendChatInput: deps.sendChatInput,
        focusChatInput: deps.focusChatInput,
      }
    )
  }

  /** Starts a chat request; a later one makes the earlier one stale */
  function beginChatRequest() {
    const request = ++chatRequest
    deps.closeModals()
    return () => !scope.stopped && request === chatRequest
  }

  async function openChat(
    payload: EventPayload<typeof DESKTOP_EVENTS.OPEN_MAIN_CHAT>
  ) {
    const isCurrent = beginChatRequest()
    const chat = await goToChatOf(payload.profileId)
    if (!isCurrent()) return
    const { attachment, question, autoSend } = payload
    const trimmedText = attachment?.text?.trim()
    const trimmedQuestion = question?.trim()
    if (payload.chatId) {
      await chat.openChat(payload.chatId)
    } else if (attachment && trimmedText) {
      await chat.startChat({
        attachments: [{ ...attachment, text: trimmedText }],
      })
    } else if (trimmedQuestion) {
      await chat.startChat({})
    } else {
      await chat.openLastChat()
    }
    if (!isCurrent()) return
    await deps.afterRender()
    if (!isCurrent() || !trimmedQuestion) return
    chat.setChatInput(trimmedQuestion)
    if (autoSend) await chat.sendChatInput()
    else chat.focusChatInput()
  }

  async function openTransferredChat(
    payload: EventPayload<typeof DESKTOP_EVENTS.OPEN_TRANSFERRED_CHAT>
  ) {
    const isCurrent = beginChatRequest()
    const chat = await goToChatOf(payload.profileId)
    if (!isCurrent()) return
    await chat.startChat({
      id: payload.chat.id,
      title: payload.chat.title,
      messages: payload.chat.messages,
    })
    if (!isCurrent()) return
    await deps.afterRender()
    if (!isCurrent()) return
    const question = payload.question?.trim()
    if (question) chat.setChatInput(question)
    chat.focusChatInput()
  }

  function start(): Promise<void> {
    if (scope.stopped) return Promise.resolve()
    if (starting) return starting
    const subscribe = <K extends keyof DesktopEventPayloads>(
      event: K,
      handler: (payload: DesktopEventPayloads[K]) => void | Promise<void>
    ) => scope.listen(deps.listen, event, handler)
    const subscriptions = [
      subscribe(DESKTOP_EVENTS.QUIT_REQUESTED, deps.shutdown.request),
      subscribe(DESKTOP_EVENTS.QUIT_CANCELLED, deps.shutdown.cancel),
      subscribe(DESKTOP_EVENTS.PLUGINS_CHANGED, deps.refreshPlugins),
      ...(deps.isQuickWindow
        ? [
            subscribe(DESKTOP_EVENTS.SCREENSHOT_FAILED, () =>
              deps.notifyScreenshotFailed?.()
            ),
          ]
        : []),
    ]
    if (deps.isQuickWindow) {
      subscriptions.push(
        subscribe(DESKTOP_EVENTS.SELECTION_RUN, async (payload) => {
          await deps.runSelection(payload)
        }),
        subscribe(DESKTOP_EVENTS.SELECTION_CANCEL, (payload) =>
          deps.cancelSelection(payload.runId)
        ),
        subscribe(DESKTOP_EVENTS.COMMAND_RUN, async (payload) => {
          await deps.runCommand(payload)
        }),
        subscribe(DESKTOP_EVENTS.EXTERNAL_JOB_CANCEL, (id) => {
          deps.cancelCommand(id)
        })
      )
    } else {
      subscriptions.push(
        subscribe(DESKTOP_EVENTS.OPEN_MAIN_CHAT, openChat),
        subscribe(DESKTOP_EVENTS.OPEN_TRANSFERRED_CHAT, openTransferredChat),
        subscribe(DESKTOP_EVENTS.OPEN_MAIN_EDITOR, async (payload) => {
          deps.applyEditorTransfer(
            payload.text ?? undefined,
            payload.sourceText ?? undefined
          )
          await deps.goToEditor()
        }),
        subscribe(
          DESKTOP_EVENTS.SETTINGS_CONFLICT,
          deps.notifySettingsConflict
        ),
        subscribe(DESKTOP_EVENTS.MAIN_WINDOW_CLOSED, async () => {
          chatRequest++
          await deps.resetMainWindow()
        })
      )
    }
    starting = Promise.all([
      ...subscriptions,
      deps.startBootstrap(),
      ...(deps.isQuickWindow ? [deps.startMetrics()] : []),
    ])
      .then(() => undefined)
      .catch(deps.reportError)
    return starting
  }

  function stop() {
    if (scope.stopped) return
    chatRequest++
    scope.stop()
    deps.shutdown.dispose()
    deps.stopBootstrap()
    deps.stopMetrics()
    void deps.disposePlugins().catch(deps.reportError)
  }

  return { start, stop }
}
