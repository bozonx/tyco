<template>
  <div class="navbar bg-base-300 text-neutral-content shadow-sm panel">
    <div class="flex-1 flex flex-row gap-2 min-w-0 items-center">
      <Button
        v-if="navPanelStore.params.escBtnAction"
        sm
        neutral
        @click="navPanelStore.params.escBtnAction"
        >{{ escBtnText }}</Button
      >
      <div
        v-if="navPanelStore.params.rightPanelVisible"
        role="tablist"
        class="tabs tabs-border nav-tabs"
        :class="{ 'ml-2': navPanelStore.params.escBtnAction }"
      >
        <a
          role="tab"
          class="tab"
          :class="{
            'tab-active': appNavigation.isCurrent(APP_ROUTES.EDITOR.path),
          }"
          @click="routeParamsStore.toEditor()"
        >
          <Icon icon="mdi:pencil" height="16" class="mr-1" />
          {{ t('nav.editor') }}
        </a>
        <a
          role="tab"
          class="tab"
          :class="{
            'tab-active': appNavigation.isCurrent(APP_ROUTES.CHAT.path),
          }"
          @click="openChat"
        >
          <Icon icon="mdi:chat-processing-outline" height="16" class="mr-1" />
          {{ t('nav.aiChat') }}
        </a>
      </div>
    </div>
    <div
      class="flex flex-row gap-1 items-center"
      v-if="navPanelStore.params.rightPanelVisible"
    >
      <Button sm neutral square @click="openHistory" :title="t('nav.history')">
        <Icon icon="mdi:history" height="20" />
      </Button>
      <Button
        :disabled="appNavigation.isCurrent(APP_ROUTES.CONFIG.path)"
        sm
        neutral
        square
        @click="openSettings"
        :title="t('nav.settings')"
      >
        <Icon icon="mdi:cog" height="24" />
      </Button>
    </div>
  </div>
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
.panel {
  min-height: 44px;
  padding: 0.375rem var(--space-lg);
}

/* Tab group inside the navbar — remove the bottom border line of tabs-border */
.nav-tabs {
  --tab-border-color: var(--app-border);
  gap: 0;
}

.nav-tabs::before,
.nav-tabs::after {
  display: none;
}
</style>
