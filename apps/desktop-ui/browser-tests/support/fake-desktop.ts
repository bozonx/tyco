import type { Page } from '@playwright/test'
import type { DesktopChannel, DesktopEventPayloads } from '@tyco/shared'

import { FakeDesktopBackend } from '../../src/test/fake-desktop-backend'

import { installTauriInternals } from './tauri-internals'

const BRIDGE_NAME = '__tycoFakeDesktopInvoke'
const EMIT_NAME = '__tycoFakeDesktopEmit'

export {
  FakeDesktopError,
  type DesktopCall,
  type FakeDesktopOptions,
} from '../../src/test/fake-desktop-backend'

/** The shared fake backend, reached by a page through `__TAURI_INTERNALS__`. */
export class FakeDesktop extends FakeDesktopBackend {
  private readonly channelIndices = new Map<number, number>()
  private page: Page | null = null

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

  async emit<K extends keyof DesktopEventPayloads>(
    event: K,
    payload: DesktopEventPayloads[K]
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
}
