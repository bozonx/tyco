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
      :key="scopeKey"
      class="chat-sidebar-panel"
      @collapse="sidebarOpen = false"
      @navigate="closeMobileSidebar"
    />
    <div class="chat-main">
      <div v-if="profile" class="profile-header">
        <Icon icon="mdi:account-outline" height="16" class="shrink-0" />
        <span class="profile-name">{{ profile.name }}</span>
        <IconButton
          class="profile-settings"
          :label="t('chat.profileSettings')"
          icon="mdi:cog-outline"
          @click="openProfileSettings"
        />
      </div>
      <AiChat :key="scopeKey" class="chat-body" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, watch } from 'vue'

import AiChat from '../components/chat/AiChat.vue'
import ChatSidebar from '../components/chat/ChatSidebar.vue'
import Icon from '../components/common/AppIcon.vue'
import IconButton from '../components/common/IconButton.vue'
import {
  provideChatScope,
  resolveChatScope,
} from '../composables/use-chat-scope'
import { useI18n } from '../composables/use-i18n'
import { appNavigation } from '../lib/navigation/navigation'
import { useAiProfilesStore } from '../stores/ai-profiles'
import { useChatLayoutStore } from '../stores/chat-layout'

const aiProfilesStore = useAiProfilesStore()
const { isSidebarOpen: sidebarOpen } = storeToRefs(useChatLayoutStore())
const { t } = useI18n()

/** "Ask AI" without a profile in the route, that profile's chat with one */
const profileId = computed(() => appNavigation.currentProfileId())
const scope = computed(() => resolveChatScope(profileId.value))
const scopeKey = computed(() => profileId.value ?? 'ask-ai')
const chatStore = computed(() => scope.value.chat)
provideChatScope(() => scope.value)

const profile = computed(() =>
  profileId.value ? aiProfilesStore.getProfile(profileId.value) : undefined
)

function closeMobileSidebar() {
  if (window.matchMedia('(max-width: 47.5rem)').matches)
    sidebarOpen.value = false
}

function openProfileSettings() {
  if (profileId.value)
    void appNavigation.goToConfig(`ai-profile:${profileId.value}`)
}

// a profile chat opened by its route starts on its last chat
watch(
  scope,
  ({ chat }) => {
    if (chat.profileId && !chat.currentChatParams.id)
      void chat.openLastOrNewChat()
  },
  { immediate: true }
)

// a removed profile, or one of another vault, has no chat to show
watch(
  () =>
    aiProfilesStore.isLoaded &&
    Boolean(profileId.value) &&
    !profile.value &&
    !aiProfilesStore.vaultError,
  (isGone) => {
    if (isGone) void appNavigation.goToChat()
  },
  { immediate: true }
)

onMounted(() => {
  if (!aiProfilesStore.isLoaded) void aiProfilesStore.loadAll()
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
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}
.chat-body {
  flex: 1;
  min-height: 0;
}
.profile-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  border-bottom: 1px solid var(--app-border-subtle);
  color: var(--app-text-muted);
  font-size: var(--text-control);
}
.profile-name {
  min-width: 0;
  overflow: hidden;
  color: var(--color-base-content);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-settings {
  margin-left: auto;
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
