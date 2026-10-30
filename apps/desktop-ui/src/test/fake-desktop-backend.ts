import {
  DEFAULT_SESSION_STATE,
  DEFAULT_USER_CONFIG,
  ActivationMode,
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
  mode?: ActivationMode
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
 * An in-memory desktop backend shared by the jsdom tests
 * (`install-fake-desktop.ts`) and the Playwright tests
 * (`browser-tests/support/fake-desktop.ts`). It keeps the state that the UI
 * reads back (config, session, history, chats) and records every command; a
 * test replaces any command with `handle`. It knows nothing of how commands
 * reach it.
 */
export class FakeDesktopBackend {
  readonly calls: DesktopCall[] = []
  /** Commands without an explicit handler; always fail fixture teardown. */
  readonly unhandledCommands = new Set<string>()

  isFocused = true
  userConfig: UserConfig
  sessionState: SessionState
  history: EditorHistoryItem[]
  chats: Chat[]

  private revision = 1
  private nextId = 1
  private readonly mode: ActivationMode
  private readonly handlers: HandlerMap = {}

  constructor(options: FakeDesktopOptions = {}) {
    this.userConfig = structuredClone(
      options.userConfig ?? { ...DEFAULT_USER_CONFIG, isInDevelopment: true }
    )
    this.sessionState = structuredClone(
      options.sessionState ?? DEFAULT_SESSION_STATE
    )
    this.mode = options.mode ?? ActivationMode.EDITOR
    this.history = structuredClone(options.history ?? [])
    this.chats = structuredClone(options.chats ?? [])
    this.installDefaultHandlers()
  }

  handle<K extends DesktopCommandName>(command: K, handler: CommandHandler<K>) {
    ;(this.handlers as Record<string, unknown>)[command] = handler
  }

  callsOf<K extends DesktopCommandName>(command: K): DesktopCommandArgs<K>[] {
    return this.calls
      .filter((call) => call.command === command)
      .map((call) => call.args as DesktopCommandArgs<K>)
  }

  snapshot(): DesktopSnapshot {
    return {
      revision: this.revision,
      activation: {
        activationId: 1,
        windowId: null,
        selectedText: null,
        mode: this.mode,
        launcherPageId: null,
        launcherRequest: null,
        accessRequest: null,
      },
      window: { isWindowShown: true, windowProfile: 'sheet' },
      settings: {
        userConfig: structuredClone(this.userConfig),
        sessionState: structuredClone(this.sessionState),
      },
    }
  }

  /** Runs a command and wraps its outcome in the envelope of `ipc.rs`. */
  async dispatch(command: string, args: unknown) {
    if (args && typeof args === 'object' && '__tycoBinary' in args) {
      const binary = args as { __tycoBinary: number[]; meta: unknown }
      args = { bytes: new Uint8Array(binary.__tycoBinary), meta: binary.meta }
    }
    this.calls.push({ command, args })
    const handler = (this.handlers as Record<string, unknown>)[command] as
      ((args: unknown) => unknown) | undefined
    if (command === 'plugin:window|is_visible') return { ok: true, value: true }
    if (command === 'plugin:window|is_focused')
      return { ok: true, value: this.isFocused }
    if (!handler) this.unhandledCommands.add(command)
    try {
      if (!handler) throw new Error(`Unhandled desktop command: ${command}`)
      const value = await handler(args)
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
    // Deliberately limited to single-writer saves. Native merge/validation is
    // covered by Rust and desktop smoke tests; never silently emulate it here.
    this.handle('save_user_config', ({ userConfig, baseConfig }) => {
      if (JSON.stringify(baseConfig) !== JSON.stringify(this.userConfig))
        throw new Error('Stale config requires an explicit test handler')
      this.userConfig = structuredClone(userConfig)
      this.revision++
      return this.snapshot()
    })
    this.handle('patch_session_state', ({ patch }) => {
      this.sessionState = {
        ...this.sessionState,
        ...patch,
        lastProfileChatIds: {
          ...this.sessionState.lastProfileChatIds,
          ...patch.lastProfileChatIds,
        },
      }
      this.revision++
      return this.snapshot()
    })

    this.handle('get_editor_history', () => structuredClone(this.history))
    this.handle('add_editor_history_item', ({ entry }) => {
      const { replaceId, operation, ...rest } = entry
      this.history = this.history.filter((item) => item.id !== replaceId)
      const id = this.generateId('history')
      this.history.unshift({
        ...rest,
        ...(operation ? { operation } : {}),
        id,
        createdAt: Date.now(),
      })
      return id
    })
    this.handle('delete_editor_history_item', ({ id }) => {
      this.history = this.history.filter((item) => item.id !== id)
    })
    this.handle('clear_editor_history', () => {
      this.history = []
    })
    this.handle('restore_editor_history_item', ({ item }) => {
      this.history = this.history.filter((entry) => entry.id !== item.id)
      this.history.push(structuredClone(item))
      this.history.sort((a, b) => b.createdAt - a.createdAt)
    })
    this.handle('set_editor_history_item_result', ({ id, result }) => {
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
      this.chats = [
        structuredClone(chat),
        ...this.chats.filter((item) => item.id !== chat.id),
      ]
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
    this.handle('get_secret_statuses', () => ({}))
    this.handle('get_secret_vault_state', () => 'available')
    this.handle('get_hotkey_provider_info', () => ({
      provider: 'global-shortcut',
      canConfigure: true,
      actions: {},
      systemTriggers: {},
      registered: true,
      defaults: {},
      commands: {},
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

    this.handle('get_text_insertion_status', () => ({
      keys: 'ready',
      target: 'tracked',
    }))
    this.handle('log_client_message', noop)
    this.handle('mark_activation_metric', noop)
    this.handle('submit_activation_metric_value', noop)
    this.handle('set_tool_catalog', noop)
    this.handle('set_tray_menu_labels', noop)
  }
}
