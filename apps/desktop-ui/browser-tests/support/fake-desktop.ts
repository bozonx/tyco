import type { Page } from '@playwright/test'
import {
  DEFAULT_SESSION_STATE,
  DEFAULT_USER_CONFIG,
  StartMode,
  type AppEventPayloads,
  type Chat,
  type DesktopChannel,
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
  /** Commands without an explicit handler; always fail fixture teardown. */
  readonly unhandledCommands = new Set<string>()

  isFocused = true
  userConfig: UserConfig
  sessionState: SessionState
  history: EditorHistoryItem[]
  chats: Chat[]

  private readonly channelIndices = new Map<number, number>()
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
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.channelIndices.clear()
    })
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
    await this.emitEvent(event, payload)
  }

  private async emitEvent(event: string, payload: unknown) {
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

  async setWindowFocus(isFocused: boolean) {
    this.isFocused = isFocused
    await this.emitEvent(isFocused ? 'tauri://focus' : 'tauri://blur', null)
  }

  /** Deliver real Tauri Channel envelopes, including ordered binary messages. */
  async sendChannel(channel: DesktopChannel, message: unknown) {
    if (!this.page) throw new Error('FakeDesktop is not attached to a page')
    // Channel.toJSON serializes to this marker at the IPC boundary.
    const id =
      typeof channel === 'string'
        ? Number(String(channel).replace('__CHANNEL__:', ''))
        : channel.id
    const index = this.channelIndices.get(id) ?? 0
    this.channelIndices.set(id, index + 1)
    const bytes = message instanceof Uint8Array ? [...message] : null
    await this.page.evaluate(
      ({ id, index, message, bytes }) => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__: {
              runCallback: (id: number, value: unknown) => void
            }
          }
        ).__TAURI_INTERNALS__
        internals.runCallback(id, {
          index,
          message: bytes ? new Uint8Array(bytes).buffer : message,
        })
      },
      { id, index, message: bytes ? null : message, bytes }
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
      },
    }
  }

  private async dispatch(command: string, args: unknown) {
    if (args && typeof args === 'object' && '__tycoBinary' in args)
      args = new Uint8Array((args as { __tycoBinary: number[] }).__tycoBinary)
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
      this.history = this.history.filter((entry) => entry.id !== item.id)
      this.history.push(structuredClone(item))
      this.history.sort((a, b) => b.createdAt - a.createdAt)
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
