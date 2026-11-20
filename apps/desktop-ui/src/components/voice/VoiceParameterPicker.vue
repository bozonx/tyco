<template>
  <section class="voice-param-picker" :aria-label="parameterLabel">
    <div class="voice-param-header">
      <button type="button" class="voice-param-back" @click="emit('back')">
        <AppIcon icon="mdi:arrow-left" size="sm" aria-hidden="true" />
        <span>{{ t('voiceCommands.backToCommands') }}</span>
      </button>
      <span class="voice-param-title">{{ parameterLabel }}</span>
    </div>
    <div class="voice-param-grid">
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        class="voice-param-option"
        :class="{ 'is-selected': option.id === selectedValue }"
        @click="emit('pick', option.id)"
      >
        {{ option.name }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import AppIcon from '../common/AppIcon.vue'

defineProps<{
  parameterLabel: string
  options: readonly { id: string; name: string }[]
  selectedValue?: string
}>()

const emit = defineEmits<{ pick: [value: string]; back: [] }>()

const { t } = useI18n()
</script>

<style scoped>
.voice-param-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-xs);
  border-left: 1px solid var(--app-border-subtle);
}

.voice-param-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
  padding: 0 var(--space-xs);
}

.voice-param-back {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.375rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  cursor: pointer;
}

.voice-param-back:hover {
  background: var(--app-hover);
  color: var(--color-base-content);
}

.voice-param-title {
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--app-text-muted);
}

.voice-param-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem;
}

.voice-param-option {
  padding: 0.375rem var(--space-sm);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-base-content);
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.voice-param-option:hover {
  background-color: var(--app-hover);
}

.voice-param-option.is-selected {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  background-color: color-mix(in oklab, var(--color-primary) 12%, transparent);
}

@container (max-width: 600px) {
  .voice-param-picker {
    border-left: none;
    border-top: 1px solid var(--app-border-subtle);
  }
}
</style>
