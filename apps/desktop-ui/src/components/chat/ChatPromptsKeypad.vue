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
        <PromptPagesBar
          v-if="profilePages.length > 1"
          :pages="profilePages"
          :active-index="currentView?.index ?? -1"
          :label="pageLabel"
          has-keys
          @select="selectPage"
        />
        <div class="chat-prompts-grid-5x3">
          <template v-for="slot in slots" :key="slot.key">
            <ShortcutButton
              v-if="slot.item"
              size="sm"
              :keys="[slot.key.toUpperCase()]"
              :title="slot.label"
              @click="handleSelect(slot.item.prompt.rule)"
            >
              {{ slot.label }}
            </ShortcutButton>
            <div v-else class="shortcut-empty-slot" aria-hidden="true" />
          </template>
        </div>
        <div v-if="!hasConfiguredPrompts" class="chat-prompts-empty-hint">
          {{ t('chat.noPromptsConfigured') }}
        </div>
      </div>
    </MenuSurface>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useAnchoredPanel } from '../../composables/use-anchored-panel'
import { useChatScope } from '../../composables/use-chat-scope'
import { useI18n } from '../../composables/use-i18n'
import { usePromptPages } from '../../composables/use-prompt-pages'
import {
  promptPagesOfProfile,
  promptSlots,
} from '../../lib/chat-prompts/prompt-pages'
import MenuSurface from '../common/MenuSurface.vue'
import PromptPagesBar from '../menu/PromptPagesBar.vue'
import ShortcutButton from '../overlay/ShortcutButton.vue'
import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

const props = defineProps<{ isOpen: boolean; anchor: HTMLElement | null }>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', rule: string): void
}>()

const { t } = useI18n()
const { chat: chatStore } = useChatScope()
const { views, pageLabel } = usePromptPages()
const surfaceRef = ref<InstanceType<typeof MenuSurface> | null>(null)
const canTeleport = ref(false)

const { style: panelStyle, theme: panelTheme } = useAnchoredPanel({
  isOpen: () => props.isOpen,
  anchor: () => props.anchor,
  panel: () => surfaceRef.value?.$el ?? null,
  placement: () => 'top',
  align: () => 'start',
})

/** Only the pages of the profile of this chat */
const profilePages = computed(() =>
  promptPagesOfProfile(views.value, chatStore.profileId)
)
const pagePosition = ref(0)
const currentView = computed(
  () => profilePages.value[pagePosition.value] ?? profilePages.value[0] ?? null
)

function selectPage(index: number) {
  const position = profilePages.value.findIndex((view) => view.index === index)
  if (position >= 0) pagePosition.value = position
}

const slots = computed(() => {
  const items = promptSlots(currentView.value?.page)
  return SHORTCUT_SLOT_KEYS.map((key, index) => {
    const item = items[index] ?? null
    return { key, item, label: item?.label ?? '' }
  })
})

const hasConfiguredPrompts = computed(() => slots.value.some((s) => s.item))

function handleSelect(rule: string) {
  emit('select', rule)
  emit('close')
}

function handleKeyDown(event: KeyboardEvent) {
  if (!props.isOpen) return

  if (event.code === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }

  let codeLetter: string | undefined
  if (event.code.length === 4 && event.code.startsWith('Key')) {
    codeLetter = event.code.slice(3).toLowerCase()
  }

  if (codeLetter) {
    const matchedSlot = slots.value.find((s) => s.key === codeLetter)
    if (matchedSlot?.item) {
      event.preventDefault()
      handleSelect(matchedSlot.item.prompt.rule)
    }
    return
  }

  const count = profilePages.value.length
  if (count <= 1) return
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1]
  if (digit !== undefined) {
    const position = digit === '0' ? 9 : Number(digit) - 1
    if (position < count) {
      event.preventDefault()
      pagePosition.value = position
    }
  } else if (event.code === 'PageDown' || event.code === 'ArrowRight') {
    event.preventDefault()
    pagePosition.value = (pagePosition.value + 1) % count
  } else if (event.code === 'PageUp' || event.code === 'ArrowLeft') {
    event.preventDefault()
    pagePosition.value = (pagePosition.value - 1 + count) % count
  }
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
      pagePosition.value = 0
      window.addEventListener('keydown', handleKeyDown, true)
      window.addEventListener('pointerdown', handlePointerDown, true)
    } else {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown, true)
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

.chat-prompts-grid-5x3 {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-template-rows: repeat(3, 2.125rem);
  gap: var(--space-xs);
}

.shortcut-empty-slot {
  min-height: 2.125rem;
  border-radius: var(--radius-sm);
  background: var(--app-surface-soft);
  opacity: 0.35;
}

.chat-prompts-empty-hint {
  font-size: var(--text-label);
  color: var(--color-base-muted);
  text-align: center;
  padding: var(--space-xs) 0;
}
</style>
