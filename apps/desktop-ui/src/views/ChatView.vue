<template>
  <div class="chat-view">
    <div v-if="!sidebarOpen" class="sidebar-closed-tools">
      <button
        type="button"
        class="sidebar-tool"
        :title="t('chat.openSidebar')"
        @click="sidebarOpen = true"
      >
        <Icon icon="mdi:dock-left" height="19" />
      </button>
      <button
        type="button"
        class="sidebar-tool"
        :title="t('chat.newChat')"
        :disabled="chatStore.isGenerating"
        @click="chatStore.startChat({})"
      >
        <Icon icon="mdi:plus" height="19" />
      </button>
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

import AiChat from '../components/AiChat.vue'
import ChatSidebar from '../components/chat/ChatSidebar.vue'
import { useI18n } from '../composables/useI18n'
import { useChatStore } from '../stores/chat'
import { useHistoryStore } from '../stores/history'
import { useNavPanelStore } from '../stores/navPanel'
import { Icon } from '@iconify/vue'

const navPanelStore = useNavPanelStore()
const historyStore = useHistoryStore()
const chatStore = useChatStore()
const { t } = useI18n()
const sidebarOpen = ref(true)

function closeMobileSidebar() {
  if (window.matchMedia('(max-width: 760px)').matches) sidebarOpen.value = false
}

navPanelStore.resetNavParams({})

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
  top: 0.7rem;
  left: 0.7rem;
  z-index: 5;
  display: flex;
  gap: 0.15rem;
}
.sidebar-tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-md);
  color: var(--app-text-muted);
  cursor: pointer;
}
.sidebar-tool:disabled {
  opacity: 0.45;
  cursor: default;
}
.sidebar-tool:not(:disabled):hover {
  background: var(--app-hover);
  color: var(--color-base-content);
}
.sidebar-backdrop {
  display: none;
}
@media (max-width: 760px) {
  .chat-sidebar-panel {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 20;
    box-shadow: var(--app-shadow-lg);
  }
  .sidebar-backdrop {
    position: absolute;
    inset: 0;
    z-index: 19;
    display: block;
    background: rgb(0 0 0 / 0.28);
  }
}
</style>
