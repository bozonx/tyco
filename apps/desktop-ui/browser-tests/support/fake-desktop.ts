import type { Page } from '@playwright/test'
import {
  APP_CONFIG,
  DEFAULT_SESSION_STATE,
  DEFAULT_USER_CONFIG,
  StartMode,
  type AppEventPayloads,
  type Chat,
  type DesktopCommandArgs,
  type DesktopCommandName,
  type DesktopCommandResult,
  type DesktopErrorPayload,
  type DesktopSnapshot,
  type EditorHistoryItem,
  type SessionState,
  type UserConfig,
} from '@tyco/shared'

import { installTauriInternals } from './tauri-internals'

const BRIDGE_NAME = '__tycoFakeDesktopInvoke'
const EMIT_NAME = '__tycoFakeDesktopEmit'

type CommandHandler<K extends DesktopCommandName> = (
  args: DesktopCommandArgs<K>
) => DesktopCommandResult<K> | Promise<DesktopCommandResult<K>>

type HandlerMap = { [K in DesktopCommandName]?: CommandHandler<K> }

export interface DesktopCall {
  command: string
  args: unknown
}

export interface FakeDesktopOptions {
  userConfig?: UserConfig
  sessionState?: SessionState
  mode?: StartMode
  windowLabel?: string
  history?: EditorHistoryItem[]
  chats?: Chat[]
}

/** A native command failure as the Rust side serializes it. */
export class FakeDesktopError extends Error {
  constructor(readonly payload: DesktopErrorPayload) {
    super(payload.message)
  }
}

/**
 * An in-memory desktop backend for browser tests. It keeps the state that the
 * UI reads back (config, session, history, chats) and records every command; a
 * test replaces any command with `handle`.
 */
export class FakeDesktop {
  readonly calls: DesktopCall[] = []
  /** Commands that reached the default no-op reply. */
  readonly unhandledCommands = new Set<string>()

  userConfig: UserConfig
  sessionState: SessionState
  history: EditorHistoryItem[]
  chats: Chat[]

  private revision = 1
  private nextId = 1
  private readonly mode: StartMode
  private readonly handlers: HandlerMap = {}
  private page: Page | null = null

  constructor(options: FakeDesktopOptions = {}) {
    this.userConfig = structuredClone(options.userConfig ?? DEFAULT_USER_CONFIG)
    this.sessionState = structuredClone(
      options.sessionState ?? DEFAULT_SESSION_STATE
    )
    this.mode = options.mode ?? StartMode.EDITOR
    this.history = structuredClone(options.history ?? [])
    this.chats = structuredClone(options.chats ?? [])
    this.installDefaultHandlers()
  }

  async attach(page: Page, windowLabel = 'main') {
    this.page = page
    await page.exposeFunction(BRIDGE_NAME, (command: string, args: unknown) =>
      this.dispatch(command, args)
    )
    await page.addInitScript(installTauriInternals, {
      bridgeName: BRIDGE_NAME,
      emitName: EMIT_NAME,
      windowLabel,
    })
  }

  handle<K extends DesktopCommandName>(command: K, handler: CommandHandler<K>) {
    ;(this.handlers as Record<string, unknown>)[command] = handler
  }

  callsOf<K extends DesktopCommandName>(command: K): DesktopCommandArgs<K>[] {
    return this.calls
      .filter((call) => call.command === command)
      .map((call) => call.args as DesktopCommandArgs<K>)
  }

  async emit<K extends keyof AppEventPayloads>(
    event: K,
    payload: AppEventPayloads[K]
  ) {
    if (!this.page) throw new Error('FakeDesktop is not attached to a page')
    await this.page.evaluate(
      ([name, eventName, eventPayload]) => {
        const emit = (window as unknown as Record<string, unknown>)[name] as (
          event: string,
          payload: unknown
        ) => void
        emit(eventName, eventPayload)
      },
      [EMIT_NAME, event, payload] as const
    )
  }

  snapshot(): DesktopSnapshot {
    return {
      revision: this.revision,
      activation: {
        activationId: 1,
        windowId: null,
        selectedText: null,
        mode: this.mode,
      },
      window: { isWindowShown: true, windowProfile: 'sheet' },
      settings: {
        userConfig: structuredClone(this.userConfig),
        sessionState: structuredClone(this.sessionState),
        appConfig: APP_CONFIG,
      },
    }
  }

  private async dispatch(command: string, args: unknown) {
    this.calls.push({ command, args })
    const handler = (this.handlers as Record<string, unknown>)[command] as
      ((args: unknown) => unknown) | undefined
    if (!handler) this.unhandledCommands.add(command)
    try {
      const value = handler ? await handler(args) : null
      return { ok: true, value: value ?? null }
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof FakeDesktopError
            ? error.payload
            : { code: 'operationFailed', message: String(error) },
      }
    }
  }

  private generateId(prefix: string) {
    return `${prefix}-${this.nextId++}`
  }

  private installDefaultHandlers() {
    const noop = () => undefined

    this.handle('get_desktop_state', () => this.snapshot())
    this.handle('get_user_config', () => structuredClone(this.userConfig))
    this.handle('save_user_config', ({ userConfig }) => {
      this.userConfig = structuredClone(userConfig)
      this.revision++
      return this.snapshot()
    })
    this.handle('patch_session_state', ({ patch }) => {
      this.sessionState = { ...this.sessionState, ...patch }
      this.revision++
      return this.snapshot()
    })

    this.handle('get_editor_history', () => structuredClone(this.history))
    this.handle('save_editor_history', ({ entry }) => {
      const { replaceId, ...rest } = entry
      this.history = this.history.filter((item) => item.id !== replaceId)
      const id = this.generateId('history')
      this.history.unshift({ ...rest, id, createdAt: Date.now() })
      return id
    })
    this.handle('remove_from_editor_history', ({ id }) => {
      this.history = this.history.filter((item) => item.id !== id)
    })
    this.handle('clear_editor_history', () => {
      this.history = []
    })
    this.handle('restore_editor_history_item', ({ item }) => {
      this.history.unshift(item)
    })
    this.handle('set_editor_history_result', ({ id, result }) => {
      const item = this.history.find((entry) => entry.id === id)
      if (item) item.result = result
    })

    this.handle('list_chats', () =>
      this.chats.map(({ id, title, lastMessageAt }) => ({
        id,
        title,
        lastMessageAt,
      }))
    )
    this.handle('get_chat', ({ id }) =>
      structuredClone(this.chats.find((chat) => chat.id === id) ?? null)
    )
    this.handle('save_chat', ({ chat }) => {
      this.chats = [chat, ...this.chats.filter((item) => item.id !== chat.id)]
    })
    this.handle('delete_chat', ({ id }) => {
      this.chats = this.chats.filter((chat) => chat.id !== id)
    })
    this.handle('rename_chat', ({ id, title }) => {
      const chat = this.chats.find((item) => item.id === id)
      if (chat) chat.title = title
    })
    this.handle('clear_chats', () => {
      this.chats = []
    })
    this.handle('search_chats', ({ query }) =>
      this.chats
        .filter((chat) =>
          JSON.stringify(chat).toLowerCase().includes(query.toLowerCase())
        )
        .map((chat) => chat.id)
    )
    this.handle('sync_chat_images', noop)

    this.handle('get_ai_vault_path', () => '/home/tester/.local/share/tyco/ai')
    this.handle('list_ai_profiles', () => [])
    this.handle('list_ai_projects', () => [])
    this.handle('list_installed_plugins', () => [])
    this.handle('secrets_status', () => ({}))
    this.handle('secrets_vault_state', () => 'available')
    this.handle('get_hotkey_provider_info', () => ({
      provider: 'global-shortcut',
      canConfigure: true,
      actions: {},
      systemTriggers: {},
      registered: true,
      defaults: {},
      platform: 'linux',
    }))
    this.handle('get_storage_info', () => ({
      locations: [
        { kinds: ['config'], path: '/home/tester/.config/tyco' },
        { kinds: ['data'], path: '/home/tester/.local/share/tyco' },
        { kinds: ['cache'], path: '/home/tester/.cache/tyco' },
        { kinds: ['logs'], path: '/home/tester/.local/state/tyco' },
      ],
    }))

    this.handle('log_client_message', noop)
    this.handle('mark_activation_metric', noop)
    this.handle('submit_activation_metric_value', noop)
    this.handle('set_tool_catalog', noop)
  }
}
