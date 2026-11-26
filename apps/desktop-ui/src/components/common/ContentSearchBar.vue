<template>
  <div
    ref="rootEl"
    class="content-search-bar"
    role="search"
    :aria-label="placeholder || t('editor.search.find')"
    @keydown.stop="onKeyDown"
  >
    <AppIcon icon="mdi:magnify" size="sm" class="search-bar-icon shrink-0" />
    <input
      ref="inputRef"
      type="search"
      class="search-bar-input"
      :value="modelValue"
      :placeholder="placeholder || t('editor.search.find')"
      @input="onInput"
      @keydown.enter.prevent="onEnter"
      @keydown.esc.prevent="emit('close')"
    />
    <span v-if="modelValue.trim()" class="search-bar-count">
      {{ countText }}
    </span>
    <IconButton
      size="xs"
      variant="ghost"
      :active="matchCase"
      :aria-pressed="matchCase"
      icon="mdi:format-letter-case"
      :label="t('editor.search.matchCase')"
      :title="t('editor.search.matchCase')"
      @click="emit('update:matchCase', !matchCase)"
    />
    <IconButton
      size="xs"
      variant="ghost"
      :disabled="count === 0"
      icon="mdi:chevron-up"
      :label="t('editor.search.previous')"
      :title="t('editor.search.previous')"
      @click="emit('prev')"
    />
    <IconButton
      size="xs"
      variant="ghost"
      :disabled="count === 0"
      icon="mdi:chevron-down"
      :label="t('editor.search.next')"
      :title="t('editor.search.next')"
      @click="emit('next')"
    />
    <IconButton
      size="xs"
      variant="ghost"
      icon="mdi:close"
      :label="t('common.close')"
      :title="t('common.close')"
      @click="emit('close')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import AppIcon from './AppIcon.vue'
import IconButton from './IconButton.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    count: number
    activeIndex: number
    matchCase?: boolean
    placeholder?: string
  }>(),
  { matchCase: false, placeholder: undefined }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'update:matchCase', value: boolean): void
  (e: 'next'): void
  (e: 'prev'): void
  (e: 'close'): void
}>()

const { t } = useI18n()
const rootEl = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

const countText = computed(() => {
  if (!props.modelValue.trim()) return ''
  if (props.count === 0) return t('common.noMatches')
  return t('common.matchCount', {
    current: props.activeIndex + 1,
    total: props.count,
  })
})

const onInput = (event: Event) => {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

const onEnter = (event: KeyboardEvent) => {
  if (event.shiftKey) {
    emit('prev')
  } else {
    emit('next')
  }
}

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  void nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
})
</script>

<style scoped>
.content-search-bar {
  position: absolute;
  top: 0.75rem;
  right: 1rem;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  box-shadow: var(--app-shadow-md);
  color: var(--color-base-content);
  max-width: calc(100% - 2rem);
}

.search-bar-icon {
  color: var(--app-text-muted);
}

.search-bar-input {
  height: var(--control-size-sm);
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--text-control);
  font-family: inherit;
  color: var(--color-base-content);
  width: 10rem;
  min-width: 6rem;
}

.search-bar-input::placeholder {
  color: var(--app-text-muted);
}

.search-bar-count {
  font-size: var(--text-xs);
  color: var(--app-text-muted);
  white-space: nowrap;
  padding: 0 0.25rem;
  user-select: none;
}
</style>
