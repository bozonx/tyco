<template>
  <ActionOverlayLayout :title="t('menu.chatPrompts')" :on-esc="close">
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <div class="chat-prompts-menu">
        <PromptPagesBar
          v-if="views.length > 1"
          :pages="views"
          :active-index="navigation.pageIndex.value"
          :label="pageLabel"
          has-keys
          @select="navigation.setPage"
        />
        <InlineNotice
          v-if="pageError"
          kind="error"
          announcement="assertive"
          :message="pageError"
        >
          <Button size="sm" variant="ghost" @click="openSettings">
            {{ t('chatPrompts.openSettings') }}
          </Button>
        </InlineNotice>
        <InlineNotice
          v-else-if="currentView?.isProfileMissing"
          kind="warning"
          announcement="polite"
          :message="t('chatPrompts.profileMissing')"
        >
          <Button size="sm" variant="ghost" @click="openSettings">
            {{ t('chatPrompts.openSettings') }}
          </Button>
        </InlineNotice>
        <ShortcutList
          v-if="!pageError"
          :key="navigation.pageIndex.value"
          :text="props.text"
          :left-letter-keys="leftLetterKeys"
          :shortcuts-disabled="props.shortcutsDisabled"
          :is-editor-button-visible="!editorNavigation.isEditorPage()"
        />
      </div>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import { usePromptPages } from '../../composables/use-prompt-pages'
import { useViewModeArrowKeys } from '../../composables/use-view-mode-arrow-keys'
import { createPromptPageNavigation } from '../../lib/chat-prompts/prompt-page-navigation'
import { promptSlots } from '../../lib/chat-prompts/prompt-pages'
import { desktopClient } from '../../lib/desktop/client'
import type { ChatPromptsMenuParams } from '../../lib/modals/menu-modal-params'
import type { ActionItem } from '../../stores/action-menu'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import Button from '../common/Button.vue'
import InlineNotice from '../common/InlineNotice.vue'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import PromptPagesBar from './PromptPagesBar.vue'
import { DESKTOP_EVENTS } from '@tyco/shared'

const props = withDefaults(defineProps<ChatPromptsMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  pageIndex: 0,
})

const editorNavigation = useEditorNavigation()
const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const ipcStore = useIpcStore()
const { t } = useI18n()
const { handleEsc } = useOverlayNav()
const { views, pageLabel } = usePromptPages()

const navigation = createPromptPageNavigation({
  pageCount: () => views.value.length,
})
/**
 * The page a hotkey asked for when there is no such page; reported until the
 * user turns to a page that exists
 */
const missingPageIndex = ref<number | null>(null)

const currentView = computed(() => views.value[navigation.pageIndex.value])

const pageError = computed(() => {
  if (!views.value.length) return t('chatPrompts.noPages')
  if (missingPageIndex.value !== null) {
    return t('chatPrompts.pageNotFound', { page: missingPageIndex.value + 1 })
  }
  return ''
})

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() => {
  const view = currentView.value
  if (!view || view.isProfileMissing) return []
  return promptSlots(view.page).map((slot) =>
    slot
      ? {
          name: slot.label,
          action: () => runPrompt(slot.prompt.rule, view.page.profileId),
        }
      : undefined
  )
})

function close() {
  handleEsc()
}

async function runPrompt(rule: string, profileId: string) {
  const prompt = rule.trim()
  if (!prompt) return
  menuModalsStore.nextModal(MenuModals.QUICK_AI_REQUEST, {
    text: props.text,
    profileId: profileId || null,
    prompt,
    isPromptSent: Boolean(
      desktopStore.userConfig.chatPrompts?.isSentImmediately
    ),
  })
}

function openSettings() {
  void ipcStore.callOrNotify('activate_mode', { mode: 'config' })
}

/** Opens the page a hotkey asked for, or reports that there is none */
function requestPage(index: number, open: (index: number) => void) {
  if (index >= views.value.length) {
    missingPageIndex.value = index
    return
  }
  missingPageIndex.value = null
  open(index)
}

function turnPage(turn: () => void) {
  missingPageIndex.value = null
  turn()
}

/** Another menu on top of this one, e.g. the request, keeps the keys */
const isCovered = () =>
  menuModalsStore.hasOpenModal &&
  menuModalsStore.currentStep?.modal !== MenuModals.CHAT_PROMPTS

useViewModeArrowKeys((step) => {
  if (isCovered() || views.value.length <= 1) return
  if (step === 1) turnPage(navigation.nextPage)
  else if (step === -1) turnPage(navigation.prevPage)
})

function onKeyDown(event: KeyboardEvent) {
  if (props.shortcutsDisabled || isCovered() || views.value.length <= 1) {
    return
  }
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
    return
  }
  if (event.key === 'PageDown') {
    event.preventDefault()
    turnPage(navigation.nextPage)
  } else if (event.key === 'PageUp') {
    event.preventDefault()
    turnPage(navigation.prevPage)
  } else if (/^[0-9]$/.test(event.key)) {
    const target = event.key === '0' ? 9 : Number(event.key) - 1
    if (target < views.value.length) {
      event.preventDefault()
      turnPage(() => navigation.setPage(target))
    }
  }
}

let stopPageTurn: (() => void) | undefined
let unmounted = false

onMounted(() => {
  requestPage(props.pageIndex, navigation.openPage)
  window.addEventListener('keydown', onKeyDown)
  void desktopClient
    .listen(DESKTOP_EVENTS.ACTION_PAGE_TURN, ({ activationId, pageIndex }) => {
      if (
        activationId !== desktopStore.desktopState.activationId ||
        !desktopStore.desktopState.isWindowShown ||
        desktopStore.desktopState.mode !== 'chatPrompts'
      ) {
        return
      }
      if (menuModalsStore.hasOpenModal || menuModalsStore.pendingModal) {
        menuModalsStore.cancelAndCloseAll()
      }
      requestPage(pageIndex, navigation.repeatOpenPage)
    })
    .then((stop) => {
      if (unmounted) stop()
      else stopPageTurn = stop
    })
    .catch(() => undefined)
})

onUnmounted(() => {
  unmounted = true
  stopPageTurn?.()
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.chat-prompts-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
</style>
