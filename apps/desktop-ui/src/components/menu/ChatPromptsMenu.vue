<template>
  <ActionOverlayLayout :title="t('menu.chatPrompts')" :on-esc="close">
    <template #preview>
      <ContextPreview
        v-if="props.text"
        v-model:disabled="isContextDisabled"
        :text="props.text"
      />
    </template>

    <template #actions>
      <SearchShortcutGrid
        v-model:query="query"
        :items="filteredItems"
        :placeholder="t('chatPrompts.searchPlaceholder')"
        :empty-text="
          views.length ? t('chatPrompts.noMatches') : t('chatPrompts.empty')
        "
        :shortcuts-disabled="props.shortcutsDisabled"
        @select="runPrompt($event.view)"
        @escape="onEscape"
      >
        <template #title="{ item }">
          <span class="chat-prompt-name">{{ item.view.label }}</span>
        </template>
        <template #item="{ item }">
          <ChatPromptProfileBadge :view="item.view" />
          <span class="chat-prompt-text">{{ item.view.prompt.rule }}</span>
        </template>
      </SearchShortcutGrid>
      <InlineNotice
        v-if="!views.length"
        class="chat-prompts-notice"
        kind="info"
        :message="t('chatPrompts.emptyHint')"
      >
        <Button size="sm" variant="ghost" @click="openSettings">
          {{ t('chatPrompts.openSettings') }}
        </Button>
      </InlineNotice>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useChatPrompts } from '../../composables/use-chat-prompts'
import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import {
  type ChatPromptView,
  filterChatPrompts,
} from '../../lib/chat-prompts/chat-prompts'
import type { ChatPromptsMenuParams } from '../../lib/modals/menu-modal-params'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import ChatPromptProfileBadge from '../chat/ChatPromptProfileBadge.vue'
import Button from '../common/Button.vue'
import InlineNotice from '../common/InlineNotice.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ContextPreview from '../overlay/ContextPreview.vue'
import SearchShortcutGrid from './SearchShortcutGrid.vue'

const props = withDefaults(defineProps<ChatPromptsMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
})

const isContextDisabled = ref(false)
const activeText = computed(() => (isContextDisabled.value ? '' : props.text))
const query = ref('')

const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const ipcStore = useIpcStore()
const { t } = useI18n()
const { handleEsc, handleCloseAll } = useOverlayNav()
const { views } = useChatPrompts()

/** The grid keys its cells by id */
const filteredItems = computed(() =>
  filterChatPrompts(views.value, query.value).map((view) => ({
    id: view.prompt.id,
    view,
  }))
)

function close() {
  handleEsc()
}

function onEscape(isShifted: boolean) {
  if (isShifted) handleCloseAll()
  else handleEsc()
}

function runPrompt(view: ChatPromptView) {
  const prompt = view.prompt.rule.trim()
  if (!prompt) return
  menuModalsStore.nextModal(MenuModals.QUICK_AI_REQUEST, {
    text: activeText.value,
    profileId: view.runProfileId,
    prompt,
    isPromptSent: Boolean(
      desktopStore.userConfig.chatPrompts?.isSentImmediately
    ),
  })
}

function openSettings() {
  void ipcStore.callOrNotify('activate_mode', { mode: 'config' })
}
</script>

<style scoped>
.chat-prompt-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.chat-prompt-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.chat-prompts-notice {
  margin-top: var(--space-xs);
}
</style>
