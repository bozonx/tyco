import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_DESKTOP_VIEW_STATE, StartMode } from '@tyco/shared'
import {
  createAppStateSync,
  type AppStateSyncDependencies,
} from './app-state-sync'

function fixture(isQuickWindow = false) {
  const state = ref(structuredClone(DEFAULT_DESKTOP_VIEW_STATE))
  const locale = ref('en_US')
  const route = ref('/editor')
  const deps: AppStateSyncDependencies = {
    isQuickWindow,
    getDesktopState: () => state.value,
    getLocale: () => locale.value,
    getRoutePath: () => route.value,
    reloadPlugins: vi.fn(async () => {}),
    syncLocale: vi.fn(),
    syncDocumentLanguage: vi.fn(),
    updateTitle: vi.fn(),
    patchLastMode: vi.fn(async () => {}),
    replaceEditorValue: vi.fn(),
    focusEditor: vi.fn(),
    startChatWithAttachment: vi.fn(),
    getEditorSelection: () => '',
    reportError: vi.fn(),
  }
  const sync = createAppStateSync(deps)
  sync.start()
  return { state, locale, route, deps, sync }
}

describe('application state synchronization', () => {
  it('reacts only to language inputs and locale changes when updating document language', async () => {
    const f = fixture()
    vi.mocked(f.deps.syncDocumentLanguage).mockClear()
    f.state.value.userConfig.appearance.theme = 'dark'
    f.state.value.userConfig.aiRules.chat = 'Updated rules'
    await nextTick()
    expect(f.deps.syncDocumentLanguage).not.toHaveBeenCalled()
    f.state.value.userConfig.appLanguage = 'tr_TR'
    await nextTick()
    expect(f.deps.syncLocale).toHaveBeenLastCalledWith(
      'tr_TR',
      f.state.value.userConfig.userLanguage
    )
    expect(f.deps.syncDocumentLanguage).toHaveBeenCalledOnce()
    f.locale.value = 'tr_TR'
    await nextTick()
    expect(f.deps.updateTitle).toHaveBeenCalledTimes(2)
    f.sync.stop()
  })

  it('persists route modes only when they differ from desktop state', async () => {
    const f = fixture()
    f.state.value.sessionState.lastMode = StartMode.CHAT
    f.route.value = '/chat'
    await nextTick()
    expect(f.deps.patchLastMode).not.toHaveBeenCalled()
    f.route.value = '/history'
    await nextTick()
    expect(f.deps.patchLastMode).toHaveBeenCalledWith(StartMode.HISTORY)
    f.sync.stop()
  })

  it('captures editor and chat selection once per activation in the main window', async () => {
    const f = fixture()
    Object.assign(f.state.value, {
      activationId: 1,
      mode: StartMode.EDITOR,
      isWindowShown: true,
      selectedText: 'Editor selection',
    })
    await nextTick()
    expect(f.deps.replaceEditorValue).toHaveBeenCalledWith('Editor selection')
    expect(f.deps.focusEditor).toHaveBeenCalledOnce()
    f.state.value.selectedText = 'Late duplicate'
    await nextTick()
    expect(f.deps.replaceEditorValue).toHaveBeenCalledOnce()
    Object.assign(f.state.value, {
      activationId: 2,
      mode: StartMode.CHAT,
      selectedText: ' Chat context ',
    })
    await nextTick()
    expect(f.deps.startChatWithAttachment).toHaveBeenCalledWith({
      text: 'Chat context',
      source: 'selection',
    })
    f.sync.stop()
    f.state.value.activationId = 3
    await nextTick()
    expect(f.deps.startChatWithAttachment).toHaveBeenCalledOnce()
  })

  it('does not capture selections in the quick window and stops plugin effects on disposal', async () => {
    const f = fixture(true)
    Object.assign(f.state.value, {
      activationId: 1,
      mode: StartMode.EDITOR,
      isWindowShown: true,
      selectedText: 'Text',
    })
    f.state.value.userConfig.plugins.example = { enabled: true }
    await nextTick()
    expect(f.deps.replaceEditorValue).not.toHaveBeenCalled()
    expect(f.deps.reloadPlugins).toHaveBeenCalledOnce()
    f.sync.stop()
    f.state.value.userConfig.plugins.example = { enabled: false }
    f.state.value.userConfig.appLanguage = 'es_AR'
    await nextTick()
    expect(f.deps.reloadPlugins).toHaveBeenCalledOnce()
    expect(f.deps.syncLocale).toHaveBeenCalledOnce()
  })

  it('reports asynchronous synchronization failures', async () => {
    const f = fixture()
    const error = new Error('Unavailable')
    vi.mocked(f.deps.reloadPlugins).mockRejectedValue(error)
    vi.mocked(f.deps.patchLastMode).mockRejectedValue(error)
    f.state.value.userConfig.plugins.example = { enabled: true }
    f.route.value = '/history'
    await nextTick()
    await Promise.resolve()
    expect(f.deps.reportError).toHaveBeenCalledTimes(2)
    f.sync.stop()
  })
})
