<template>
  <Teleport to="body" :disabled="!canTeleport">
    <MenuSurface
      v-if="props.isOpen"
      ref="surfaceRef"
      :style="panelStyle"
      :data-theme="panelTheme"
      class="chat-prompts-surface"
      role="dialog"
      :aria-label="t('chat.promptPresets')"
      tabindex="-1"
    >
      <div class="chat-prompts-container">
        <SearchShortcutGrid
          v-model:query="query"
          dense
          :items="filteredItems"
          :placeholder="t('chatPrompts.searchPlaceholder')"
          :empty-text="
            profileViews.length
              ? t('chatPrompts.noMatches')
              : t('chat.noPromptsConfigured')
          "
          @select="handleSelect($event.view.prompt.rule)"
          @escape="emit('close')"
        >
          <template #title="{ item }">
            <span class="chat-prompt-name" :title="item.view.prompt.rule">{{
              item.view.label
            }}</span>
            <ChatPromptProfileBadge
              v-if="item.view.isProfileMissing"
              class="chat-prompt-badge"
              :view="item.view"
            />
          </template>
        </SearchShortcutGrid>
      </div>
    </MenuSurface>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useAnchoredPanel } from '../../composables/use-anchored-panel'
import { useChatPrompts } from '../../composables/use-chat-prompts'
import { useChatScope } from '../../composables/use-chat-scope'
import { useI18n } from '../../composables/use-i18n'
import {
  chatPromptsOfProfile,
  filterChatPrompts,
} from '../../lib/chat-prompts/chat-prompts'
import MenuSurface from '../common/MenuSurface.vue'
import SearchShortcutGrid from '../menu/SearchShortcutGrid.vue'
import ChatPromptProfileBadge from './ChatPromptProfileBadge.vue'

const props = defineProps<{ isOpen: boolean; anchor: HTMLElement | null }>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', rule: string): void
}>()

const { t } = useI18n()
const { chat: chatStore } = useChatScope()
const { views } = useChatPrompts()
const surfaceRef = ref<InstanceType<typeof MenuSurface> | null>(null)
const canTeleport = ref(false)
const query = ref('')

const { style: panelStyle, theme: panelTheme } = useAnchoredPanel({
  isOpen: () => props.isOpen,
  anchor: () => props.anchor,
  panel: () => surfaceRef.value?.$el ?? null,
  placement: () => 'top',
  align: () => 'start',
})

/** The prompts of every profile and those of the profile of this chat */
const profileViews = computed(() =>
  chatPromptsOfProfile(views.value, chatStore.profileId)
)

const filteredItems = computed(() =>
  filterChatPrompts(profileViews.value, query.value).map((view) => ({
    id: view.prompt.id,
    view,
  }))
)

function handleSelect(rule: string) {
  emit('select', rule)
  emit('close')
}

function handlePointerDown(event: PointerEvent) {
  if (!props.isOpen) return
  const target = event.target as Node | null
  if (!target) return

  const surfaceEl = surfaceRef.value?.$el as HTMLElement | undefined
  if (surfaceEl?.contains(target) || props.anchor?.contains(target)) {
    return
  }

  emit('close')
}

onMounted(() => {
  canTeleport.value = true
})

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      query.value = ''
      window.addEventListener('pointerdown', handlePointerDown, true)
    } else {
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  window.removeEventListener('pointerdown', handlePointerDown, true)
})
</script>

<style scoped>
.chat-prompts-surface {
  width: min(92vw, 32rem);
  max-width: 32rem;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--app-surface-elevated, var(--app-surface));
  z-index: 100;
}

.chat-prompts-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-xs);
}

.chat-prompt-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-label);
}

.chat-prompt-badge {
  flex-shrink: 0;
  max-width: 40%;
}
</style>
