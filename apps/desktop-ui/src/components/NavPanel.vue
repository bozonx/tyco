<template>
  <header class="app-topbar">
    <nav class="topbar-nav" :aria-label="t('app.title')">
      <button
        type="button"
        class="topbar-tab"
        :aria-current="
          appNavigation.isCurrent(APP_ROUTES.EDITOR.path) ? 'page' : undefined
        "
        :class="{
          'is-active': appNavigation.isCurrent(APP_ROUTES.EDITOR.path),
        }"
        @click="editorNavigation.toEditor()"
      >
        <Icon icon="mdi:pencil-outline" height="16" />
        {{ t('nav.editor') }}
      </button>
      <button
        type="button"
        class="topbar-tab"
        :aria-current="isBaseChatActive ? 'page' : undefined"
        :class="{ 'is-active': isBaseChatActive }"
        @click="openChat"
      >
        <Icon icon="mdi:chat-processing-outline" height="16" />
        {{ t('nav.aiChat') }}
      </button>
      <template v-if="props.profiles.length > 0">
        <div class="topbar-divider h-4 w-px bg-base-content/20 mx-1" />
        <div
          ref="profilesContainerRef"
          class="profiles-tabs-container overflow-x-auto no-scrollbar flex items-center gap-1 max-w-[calc(100vw-350px)]"
          @wheel.passive="handleProfilesWheel"
        >
          <button
            v-for="profile in props.profiles"
            :key="profile.id"
            type="button"
            class="topbar-tab shrink-0"
            :aria-current="isProfileActive(profile.id) ? 'page' : undefined"
            :class="{ 'is-active': isProfileActive(profile.id) }"
            @click="openProfileChat(profile.id)"
          >
            <Icon :icon="profile.icon || 'mdi:account-outline'" height="16" />
            <span class="truncate max-w-[120px]">{{ profile.name }}</span>
          </button>
        </div>
      </template>
    </nav>
    <div class="flex-1" />
    <div class="flex flex-row gap-1 items-center">
      <Button
        v-if="navPanelStore.navPanelState.onEscape"
        size="sm"
        variant="neutral"
        icon="mdi:lightning-bolt-outline"
        class="mr-1"
        @click="navPanelStore.navPanelState.onEscape"
        >{{ escapeButtonText
        }}<template
          v-if="
            navPanelStore.navPanelState.escapeButtonLabelKey === 'menu.actions'
          "
        >
          ({{ actionsShortcut }})</template
        ></Button
      >
      <IconButton
        size="sm"
        variant="ghost"
        :active="appNavigation.isCurrent(APP_ROUTES.HISTORY.path)"
        @click="openHistory"
        :label="t('nav.history')"
        icon="mdi:history"
      />
      <IconButton
        size="sm"
        variant="ghost"
        :active="appNavigation.isCurrent(APP_ROUTES.CONFIG.path)"
        @click="openSettings"
        :label="t('nav.settings')"
        icon="mdi:cog-outline"
      />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useEditorNavigation } from '../composables/use-editor-navigation'
import { useI18n } from '../composables/use-i18n'
import { EDITOR_ACTIONS_SHORTCUT } from '../lib/input-keys/input-keys'
import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useChatStore } from '../stores/chat'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'
import Icon from './common/AppIcon.vue'
import IconButton from './common/IconButton.vue'

export interface NavProfileTab {
  id: string
  name: string
  icon?: string
}

const props = withDefaults(defineProps<{ profiles?: NavProfileTab[] }>(), {
  profiles: () => [],
})

const editorNavigation = useEditorNavigation()
const chatStore = useChatStore()
const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const { t } = useI18n()

const profilesContainerRef = ref<HTMLElement | null>(null)

const actionsShortcut = EDITOR_ACTIONS_SHORTCUT.toUpperCase()

const escapeButtonText = computed(() => {
  return t(navPanelStore.navPanelState.escapeButtonLabelKey)
})

const currentProfileId = computed(() => {
  if (!appNavigation.isCurrent(APP_ROUTES.CHAT.path)) return null
  return appNavigation.currentProfileId?.() || null
})

const isBaseChatActive = computed(() => {
  return (
    appNavigation.isCurrent(APP_ROUTES.CHAT.path) && !currentProfileId.value
  )
})

function isProfileActive(profileId: string) {
  return (
    appNavigation.isCurrent(APP_ROUTES.CHAT.path) &&
    currentProfileId.value === profileId
  )
}

function handleProfilesWheel(event: WheelEvent) {
  if (!profilesContainerRef.value) return
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    profilesContainerRef.value.scrollLeft += event.deltaY
  }
}

function openSettings() {
  menuModalsStore.closeAll()
  void appNavigation.goToConfig()
}

function openChat() {
  menuModalsStore.closeAll()
  // the editor text stays out: the editor toolbar sends it to the chat
  void chatStore.openLastOrNewChat()
}

function openProfileChat(profileId: string) {
  menuModalsStore.closeAll()
  void appNavigation.goToProfileChat(profileId)
}

function openHistory() {
  menuModalsStore.closeAll()
  void appNavigation.goToHistory()
}
</script>

<style scoped>
.app-topbar {
  --button-ghost-color: var(--app-text-muted);
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
  font-size: var(--text-body);
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

.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
