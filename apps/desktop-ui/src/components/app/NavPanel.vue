<template>
  <header class="app-topbar">
    <nav
      ref="tabsRef"
      class="topbar-nav no-scrollbar"
      :aria-label="t('app.title')"
      :class="{
        'has-hidden-start': hasHiddenTabs.start,
        'has-hidden-end': hasHiddenTabs.end,
      }"
      @wheel.passive="handleTabsWheel"
      @scroll.passive="updateHiddenTabs"
    >
      <button
        type="button"
        class="topbar-tab"
        :aria-current="
          appNavigation.isCurrent(APP_ROUTES.EDITOR.path) ? 'page' : undefined
        "
        :class="{
          'is-active': appNavigation.isCurrent(APP_ROUTES.EDITOR.path),
        }"
        @pointerdown="preventMouseFocus"
        @click="editorNavigation.toEditor()"
      >
        <AppIcon icon="mdi:pencil-outline" size="md" />
        {{ t('nav.editor') }}
      </button>
      <button
        v-if="isDialogEnabled"
        type="button"
        class="topbar-tab"
        :aria-current="isDialogActive ? 'page' : undefined"
        :class="{ 'is-active': isDialogActive }"
        @pointerdown="preventMouseFocus"
        @click="openDialog"
      >
        <AppIcon
          :icon="
            dialogStatus.isActive ? 'mdi:record-circle' : 'mdi:account-voice'
          "
          size="md"
          :class="{ 'dialog-recording': dialogStatus.isActive }"
        />
        {{ t('nav.dialog') }}
      </button>
      <button
        v-if="isInDevelopment"
        type="button"
        class="topbar-tab"
        :aria-current="isBaseChatActive ? 'page' : undefined"
        :class="{ 'is-active': isBaseChatActive }"
        @pointerdown="preventMouseFocus"
        @click="openChat"
      >
        <AppIcon icon="mdi:chat-processing-outline" size="md" />
        {{ t('nav.aiChat') }}
      </button>
      <div v-if="isInDevelopment" class="topbar-divider" aria-hidden="true" />
      <button
        v-for="profile in profiles"
        :key="profile.id"
        type="button"
        class="topbar-tab"
        :aria-current="isProfileActive(profile.id) ? 'page' : undefined"
        :class="{ 'is-active': isProfileActive(profile.id) }"
        :title="profile.name"
        @pointerdown="preventMouseFocus"
        @click="openProfileChat(profile.id)"
      >
        <span class="truncate max-w-[120px]">{{ profile.name }}</span>
      </button>
    </nav>
    <div class="topbar-actions flex flex-row gap-1 items-center">
      <QuietRunChip @open-history="openExternalHistory" />
      <Button
        v-if="navPanelStore.navPanelState.onEscape"
        size="sm"
        variant="neutral"
        icon="mdi:lightning-bolt-outline"
        class="topbar-escape mr-1"
        :aria-label="escapeButtonText"
        :title="escapeButtonText"
        @click="navPanelStore.navPanelState.onEscape"
      >
        <span class="truncate">{{ escapeButtonText }}</span>
      </Button>
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
import { APP_ROUTES } from '../../lib/navigation/routes'
import { preventMouseFocus } from '../../lib/ui/focus'
import { appNavigation } from '../../navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { useChatStore, useProfileChatStore } from '../../stores/chat'
import { useDesktopStore } from '../../stores/desktop'
import { useDialogStatusStore } from '../../stores/dialog-status'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useNavPanelStore } from '../../stores/nav-panel'
import { useQuietRunStore } from '../../stores/quiet-run'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import IconButton from '../common/IconButton.vue'
import QuietRunChip from './QuietRunChip.vue'

const editorNavigation = useEditorNavigation()
const chatStore = useChatStore()
const aiProfilesStore = useAiProfilesStore()
const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const { t, locale } = useI18n()

const desktopStore = useDesktopStore()
// the status alone: the dialog itself loads with its view
const dialogStatus = useDialogStatusStore()
const isDialogEnabled = computed(() =>
  Boolean(desktopStore.userConfig?.dialog?.isEnabled)
)
const isDialogActive = computed(() =>
  appNavigation.isCurrent(APP_ROUTES.DIALOG.path)
)
const isInDevelopment = computed(() => desktopStore.userConfig.isInDevelopment)
const profiles = computed(() =>
  isInDevelopment.value ? aiProfilesStore.profiles : []
)

const tabsRef = ref<HTMLElement | null>(null)
/** Which edges of the navigation tabs hide tabs behind them */
const hasHiddenTabs = reactive({ start: false, end: false })

function updateHiddenTabs() {
  const element = tabsRef.value
  if (!element) return
  hasHiddenTabs.start = element.scrollLeft > 0
  hasHiddenTabs.end =
    element.scrollLeft + element.clientWidth < element.scrollWidth - 1
}

const resizeObserver =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(updateHiddenTabs)
watch(tabsRef, (element, previous) => {
  if (previous) resizeObserver?.unobserve(previous)
  if (element) resizeObserver?.observe(element)
})
watch(
  [isDialogEnabled, isInDevelopment, profiles, locale],
  () => void nextTick(updateHiddenTabs)
)

onMounted(() => {
  if (!aiProfilesStore.isLoaded) void aiProfilesStore.loadAll()
})
onBeforeUnmount(() => resizeObserver?.disconnect())

const escapeButtonText = computed(() => {
  // the key opens it too, e.g. "Actions (Esc)" in the editor
  return `${t(navPanelStore.navPanelState.escapeButtonLabelKey)} (Esc)`
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

function handleTabsWheel(event: WheelEvent) {
  if (!tabsRef.value) return
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    tabsRef.value.scrollLeft += event.deltaY
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

function openDialog() {
  menuModalsStore.closeAll()
  void appNavigation.goToDialog()
}

function openExternalHistory(id: string) {
  menuModalsStore.closeAll()
  useQuietRunStore().historyId = id
  void appNavigation.goToHistory()
}

function openHistory() {
  menuModalsStore.closeAll()
  void appNavigation.goToHistory()
}
</script>

<style scoped>
.dialog-recording {
  color: var(--color-error);
}

.topbar-divider {
  flex: 0 0 1px;
  height: 1rem;
  margin-inline: var(--space-xs);
  background-color: var(--app-border);
}

.app-topbar {
  --button-ghost-color: var(--app-text-muted);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: max(48px, calc(var(--control-size-sm) + 2 * var(--space-2xs) + 1px));
  container-type: inline-size;
  flex-shrink: 0;
  padding: 0 var(--space-md);
  border-bottom: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
}

.topbar-nav {
  --fade-start: 0px;
  --fade-end: 0px;
  mask-image: linear-gradient(
    to right,
    transparent,
    #000 var(--fade-start),
    #000 calc(100% - var(--fade-end)),
    transparent
  );
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1 1 0;
  align-self: stretch;
  min-width: min(40%, 8rem);
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}

.topbar-actions {
  min-width: 0;
}

.topbar-actions .topbar-escape {
  min-width: 0;
  flex-shrink: 1;
}

@container (max-width: 26rem) {
  .topbar-actions .topbar-escape {
    width: var(--control-size-sm);
    flex-shrink: 0;
    padding-inline: 0;
  }

  .topbar-escape > span {
    display: none;
  }
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
  white-space: nowrap;
  flex-shrink: 0;
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

.topbar-nav.has-hidden-start {
  --fade-start: 1.5rem;
}

.topbar-nav.has-hidden-end {
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
