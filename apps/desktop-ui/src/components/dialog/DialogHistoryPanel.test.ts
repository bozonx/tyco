import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../lib/i18n'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { useDialogStore } from '../../stores/dialog'
import { useDialogHistoryStore } from '../../stores/dialog-history'
import DialogHistoryPanel from './DialogHistoryPanel.vue'
import DropdownMenu from '../common/DropdownMenu.vue'
import type { Dialog } from '@tyco/shared'

describe('DialogHistoryPanel.vue', () => {
  let desktop: TestDesktop

  const sampleDialog: Dialog = {
    id: 'dialog-1',
    title: 'Test Conversation',
    startedAt: 1700000000000,
    updatedAt: 1700000060000,
    source: 'microphoneAndSystem',
    translationTargetLanguage: 'en-US',
    segments: [
      {
        id: 'seg-1',
        side: 'me',
        startMs: 0,
        endMs: 1000,
        text: 'Hello world',
        translationState: 'idle',
      },
    ],
  }

  beforeEach(async () => {
    desktop = await loadFakeDesktop({ dialogs: [sampleDialog] })
  })

  afterEach(() => {
    desktop.dispose()
  })

  it('includes Send to the action menu in item menu', async () => {
    const dialogHistoryStore = useDialogHistoryStore()
    await dialogHistoryStore.loadDialogs()

    const dialogStore = useDialogStore()
    const sendSpy = vi
      .spyOn(dialogStore, 'sendToActionMenu')
      .mockResolvedValue(undefined as never)

    const wrapper = mount(DialogHistoryPanel, {
      global: { plugins: [i18n, desktop.pinia] },
    })
    await flushPromises()

    const menu = wrapper.findComponent(DropdownMenu)
    expect(menu.exists()).toBe(true)

    const items = menu.props('items') as Array<{
      label: string
      action: () => void
    }>
    const actionMenuItem = items.find(
      (item) => item.label === i18n.global.t('dialog.toActionMenu')
    )
    expect(actionMenuItem).toBeDefined()

    actionMenuItem?.action()
    await flushPromises()

    expect(sendSpy).toHaveBeenCalledOnce()
  })
})
