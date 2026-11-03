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
        <div class="chat-prompts-grid-5x3">
          <template v-for="slot in slots" :key="slot.key">
            <ShortcutButton
              v-if="slot.item"
              size="sm"
              :keys="[slot.key.toUpperCase()]"
              :title="slot.label"
              @click="handleSelect(slot.item.rule)"
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
import { useI18n } from '../../composables/use-i18n'
import {
  slotItemLabel,
  slotItemList,
} from '../../lib/shortcut-slots/slot-library'
import { useDesktopStore } from '../../stores/desktop'
import MenuSurface from '../common/MenuSurface.vue'
import ShortcutButton from '../overlay/ShortcutButton.vue'
import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

const props = defineProps<{ isOpen: boolean; anchor: HTMLElement | null }>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', rule: string): void
}>()

const { t } = useI18n()
const desktopStore = useDesktopStore()
const surfaceRef = ref<InstanceType<typeof MenuSurface> | null>(null)
const canTeleport = ref(false)

const { style: panelStyle, theme: panelTheme } = useAnchoredPanel({
  isOpen: () => props.isOpen,
  anchor: () => props.anchor,
  panel: () => surfaceRef.value?.$el ?? null,
  placement: () => 'top',
  align: () => 'start',
})

const library = () => desktopStore.userConfig.chatPrompts
const items = computed(() => slotItemList(library()))

const slots = computed(() =>
  SHORTCUT_SLOT_KEYS.map((key, index) => {
    const item = items.value[index]
    return {
      key,
      item: item?.rule.trim() ? item : null,
      label: item ? slotItemLabel(item) : '',
    }
  })
)

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
    if (matchedSlot?.item?.rule.trim()) {
      event.preventDefault()
      handleSelect(matchedSlot.item.rule)
    }
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
