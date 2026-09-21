<template>
  <header class="app-topbar">
    <nav
      v-if="navPanelStore.params.rightPanelVisible"
      class="topbar-nav"
      role="tablist"
    >
      <button
        type="button"
        role="tab"
        class="topbar-tab"
        :class="{
          'is-active': appNavigation.isCurrent(APP_ROUTES.EDITOR.path),
        }"
        @click="routeParamsStore.toEditor()"
      >
        <Icon icon="mdi:pencil-outline" height="16" />
        {{ t('nav.editor') }}
      </button>
      <button
        type="button"
        role="tab"
        class="topbar-tab"
        :class="{ 'is-active': appNavigation.isCurrent(APP_ROUTES.CHAT.path) }"
        @click="openChat"
      >
        <Icon icon="mdi:chat-processing-outline" height="16" />
        {{ t('nav.aiChat') }}
      </button>
    </nav>
    <div class="flex-1" />
    <div
      class="flex flex-row gap-1 items-center"
      v-if="navPanelStore.params.rightPanelVisible"
    >
      <Button
        v-if="navPanelStore.params.escBtnAction"
        sm
        neutral
        icon="mdi:lightning-bolt-outline"
        class="mr-1"
        @click="navPanelStore.params.escBtnAction"
        >{{ escBtnText }}</Button
      >
      <Button
        sm
        ghost
        square
        :active="appNavigation.isCurrent(APP_ROUTES.HISTORY.path)"
        @click="openHistory"
        :title="t('nav.history')"
      >
        <Icon icon="mdi:history" height="20" />
      </Button>
      <Button
        sm
        ghost
        square
        :active="appNavigation.isCurrent(APP_ROUTES.CONFIG.path)"
        @click="openSettings"
        :title="t('nav.settings')"
      >
        <Icon icon="mdi:cog-outline" height="20" />
      </Button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../composables/useI18n'
import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useChatStore } from '../stores/chat'
import { useEditorInputStore } from '../stores/editorInput'
import { useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'
import { useRouteParams } from '../stores/routeParams'
import { Icon } from '@iconify/vue'

const routeParamsStore = useRouteParams()
const chatStore = useChatStore()
const editorInputStore = useEditorInputStore()
const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const { t } = useI18n()

const escBtnText = computed(() => {
  return navPanelStore.params.escBtnLabelKey
    ? t(navPanelStore.params.escBtnLabelKey)
    : navPanelStore.params.escBtnText || ''
})

function openSettings() {
  menuModalsStore.closeAll()
  void appNavigation.goToConfig()
}

function openChat() {
  menuModalsStore.closeAll()
  const selectedText = editorInputStore.selectedText?.trim()
  if (selectedText) {
    void chatStore.startChat({ attachments: [selectedText] })
  } else {
    void chatStore.openLastOrNewChat()
  }
}

function openHistory() {
  menuModalsStore.closeAll()
  void appNavigation.goToHistory()
}
</script>

<style scoped>
.app-topbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: 48px;
  flex-shrink: 0;
  padding: 0 var(--space-md);
  border-bottom: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
}

.topbar-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.topbar-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4375rem;
  height: 2rem;
  padding: 0 0.75rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--app-text-muted);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.topbar-tab:hover {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.topbar-tab.is-active {
  color: var(--color-base-content);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-segment);
}

.app-topbar :deep(.btn-ghost) {
  color: var(--app-text-muted);
}

.app-topbar :deep(.btn-ghost:hover),
.app-topbar :deep(.btn-ghost.btn-active) {
  color: var(--color-base-content);
}
</style>
