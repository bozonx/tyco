<template>
  <div
    class="prompt-pages-bar"
    role="group"
    :aria-label="t('chatPrompts.pages')"
  >
    <button
      v-for="(view, position) in props.pages"
      :key="view.index"
      type="button"
      class="prompt-page-button"
      :class="{
        'is-active': view.index === props.activeIndex,
        'is-missing': view.isProfileMissing,
      }"
      :aria-pressed="view.index === props.activeIndex"
      @click="emit('select', view.index)"
    >
      <KeyboardKey v-if="props.hasKeys && position < 10">{{
        position === 9 ? 0 : position + 1
      }}</KeyboardKey>
      <AppIcon
        v-if="view.isProfileMissing"
        icon="mdi:alert-outline"
        size="sm"
      />
      <span>{{ props.label(view) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import type { PromptPageView } from '../../lib/chat-prompts/prompt-pages'
import AppIcon from '../common/AppIcon.vue'
import KeyboardKey from '../common/KeyboardKey.vue'

/** The switch between prompt pages; each page shows its profile */
const props = defineProps<{
  pages: readonly PromptPageView[]
  activeIndex: number
  label: (view: PromptPageView) => string
  /** Shows the digit that opens each page */
  hasKeys?: boolean
}>()

const emit = defineEmits<{ (e: 'select', index: number): void }>()

const { t } = useI18n()
</script>

<style scoped>
.prompt-pages-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.prompt-page-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  background: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.prompt-page-button:hover {
  background: var(--app-hover);
  color: var(--color-base-content);
}

.prompt-page-button.is-active {
  color: var(--color-primary);
  background-color: var(--app-surface-raised);
  border-color: var(--color-primary);
  font-weight: 500;
}

.prompt-page-button.is-missing {
  color: var(--color-warning);
}
</style>
