<template>
  <div class="chat-view">
    <div v-if="!sidebarOpen" class="sidebar-closed-tools">
      <IconButton
        class="sidebar-tool"
        @click="sidebarOpen = true"
        :label="t('chat.openSidebar')"
        icon="mdi:dock-left"
      />
      <IconButton
        class="sidebar-tool"
        :disabled="chatStore.isGenerating"
        @click="chatStore.startNewChat()"
        :label="t('chat.newChat')"
        icon="mdi:plus"
      />
    </div>
    <button
      v-if="sidebarOpen"
      type="button"
      class="sidebar-backdrop"
      :aria-label="t('common.close')"
      @click="sidebarOpen = false"
    />
    <ChatSidebar
      v-if="sidebarOpen"
      class="chat-sidebar-panel"
      @collapse="sidebarOpen = false"
      @navigate="closeMobileSidebar"
    />
    <div class="chat-main">
      <AiChat />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import AiChat from '../components/chat/AiChat.vue'
import ChatSidebar from '../components/chat/ChatSidebar.vue'
import IconButton from '../components/common/IconButton.vue'
import { useI18n } from '../composables/use-i18n'
import { useChatStore } from '../stores/chat'
import { useHistoryStore } from '../stores/history'
import { useNavPanelStore } from '../stores/nav-panel'

const navPanelStore = useNavPanelStore()
const historyStore = useHistoryStore()
const chatStore = useChatStore()
const { t } = useI18n()
const sidebarOpen = ref(true)

function closeMobileSidebar() {
  if (window.matchMedia('(max-width: 47.5rem)').matches)
    sidebarOpen.value = false
}

navPanelStore.resetNavPanelState({})

onMounted(async () => {
  await historyStore.loadChatHistory()
})
</script>

<style scoped>
.chat-view {
  position: relative;
  display: flex;
  height: 100%;
  overflow: hidden;
}
.chat-main {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}
.sidebar-closed-tools {
  position: absolute;
  top: var(--space-md);
  left: var(--space-md);
  z-index: calc(var(--z-sidebar) - 2);
  display: flex;
  gap: var(--space-xs);
}
.sidebar-tool {
  color: var(--app-text-muted);
}
.sidebar-backdrop {
  display: none;
}
@media (max-width: 47.5rem) {
  .chat-sidebar-panel {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: var(--z-sidebar);
    box-shadow: var(--app-shadow-lg);
  }
  .sidebar-backdrop {
    position: absolute;
    inset: 0;
    z-index: calc(var(--z-sidebar) - 1);
    display: block;
    background: var(--app-sidebar-backdrop);
  }
}
</style>
