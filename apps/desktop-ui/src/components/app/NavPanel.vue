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
        <AppIcon icon="mdi:pencil-outline" size="md" />
        {{ t('nav.editor') }}
      </button>
      <button
        v-if="isInDevelopment"
        type="button"
        class="topbar-tab"
        :aria-current="isBaseChatActive ? 'page' : undefined"
        :class="{ 'is-active': isBaseChatActive }"
        @click="openChat"
      >
        <AppIcon icon="mdi:chat-processing-outline" size="md" />
        {{ t('nav.aiChat') }}
      </button>
      <div v-if="isInDevelopment" class="topbar-divider" aria-hidden="true" />
      <template v-if="profiles.length > 0">
        <div
          ref="profilesContainerRef"
          class="profiles-tabs-container overflow-x-auto no-scrollbar flex items-center gap-1 min-w-0"
          :class="{
            'has-hidden-start': hasHiddenTabs.start,
            'has-hidden-end': hasHiddenTabs.end,
          }"
          @wheel.passive="handleProfilesWheel"
          @scroll.passive="updateHiddenTabs"
        >
          <button
            v-for="profile in profiles"
            :key="profile.id"
            type="button"
            class="topbar-tab shrink-0"
            :aria-current="isProfileActive(profile.id) ? 'page' : undefined"
            :class="{ 'is-active': isProfileActive(profile.id) }"
            :title="profile.name"
            @click="openProfileChat(profile.id)"
          >
            <AppIcon :icon="profileIcon(profile)" size="md" />
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
        v-if="isInDevelopment"
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
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { profileIcon } from '../../lib/ai-profiles/profile-icons'
import { EDITOR_ACTIONS_SHORTCUT } from '../../lib/input-keys/input-keys'
import { APP_ROUTES } from '../../lib/navigation/routes'
import { appNavigation } from '../../navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { useChatStore, useProfileChatStore } from '../../stores/chat'
import { useDesktopStore } from '../../stores/desktop'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useNavPanelStore } from '../../stores/nav-panel'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import IconButton from '../common/IconButton.vue'

const editorNavigation = useEditorNavigation()
const chatStore = useChatStore()
const aiProfilesStore = useAiProfilesStore()
const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const { t } = useI18n()

const desktopStore = useDesktopStore()
const isInDevelopment = computed(() => desktopStore.userConfig.isInDevelopment)
const profiles = computed(() =>
  isInDevelopment.value ? aiProfilesStore.profiles : []
)

const profilesContainerRef = ref<HTMLElement | null>(null)
/** Which edges of the profile tabs hide tabs behind them */
const hasHiddenTabs = reactive({ start: false, end: false })

function updateHiddenTabs() {
  const element = profilesContainerRef.value
  if (!element) return
  hasHiddenTabs.start = element.scrollLeft > 0
  hasHiddenTabs.end =
    element.scrollLeft + element.clientWidth < element.scrollWidth - 1
}

const resizeObserver =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(updateHiddenTabs)
watch(profilesContainerRef, (element, previous) => {
  if (previous) resizeObserver?.unobserve(previous)
  if (element) resizeObserver?.observe(element)
})
watch(
  () => profiles.value.length,
  () => void nextTick(updateHiddenTabs)
)

onMounted(() => {
  if (!aiProfilesStore.isLoaded) void aiProfilesStore.loadAll()
})
onBeforeUnmount(() => resizeObserver?.disconnect())

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
    updateHiddenTabs()
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

/** A profile chat comes back as it was left, or on its last chat */
function openProfileChat(profileId: string) {
  menuModalsStore.closeAll()
  void useProfileChatStore(profileId).openLastOrNewChat()
}

function openHistory() {
  menuModalsStore.closeAll()
  void appNavigation.goToHistory()
}
</script>

<style scoped>
.topbar-divider {
  width: 1px;
  height: 1rem;
  margin-inline: var(--space-xs);
  background-color: var(--app-border);
}

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
  min-width: 0;
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

.profiles-tabs-container {
  --fade-start: 0px;
  --fade-end: 0px;
  mask-image: linear-gradient(
    to right,
    transparent,
    #000 var(--fade-start),
    #000 calc(100% - var(--fade-end)),
    transparent
  );
}

.profiles-tabs-container.has-hidden-start {
  --fade-start: 1.5rem;
}

.profiles-tabs-container.has-hidden-end {
  --fade-end: 1.5rem;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
