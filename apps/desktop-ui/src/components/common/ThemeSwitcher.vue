<template>
  <div class="theme-switcher" role="radiogroup" :aria-label="t('settings.theme')">
    <label
      v-for="option in themeOptions"
      :key="option.id"
      class="theme-option"
      :class="{ active: option.id === props.value }"
    >
      <input
        class="sr-only"
        type="radio"
        name="theme-mode"
        :value="option.id"
        :checked="option.id === props.value"
        @change="handleThemeChange(option.id)"
      />
      <span>{{ option.name }}</span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import type { ThemeMode } from '../../lib/theme/theme-controller'

const props = defineProps<{
  value: ThemeMode
}>()

const emit = defineEmits<{
  (e: 'update:value', value: ThemeMode): void
}>()

const { t } = useI18n()

const themeOptions = computed(() => [
  { id: 'auto', name: t('theme.auto') },
  { id: 'light', name: t('theme.light') },
  { id: 'dark', name: t('theme.dark') },
])

function handleThemeChange(value: number | string | undefined) {
  if (value !== 'auto' && value !== 'light' && value !== 'dark') {
    return
  }

  emit('update:value', value)
}
</script>

<style scoped>
.theme-switcher {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.theme-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2rem;
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-surface);
  color: oklch(var(--bc));
  font-size: 0.8125rem;
  line-height: 1.2;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.theme-option:hover {
  background: var(--app-surface-raised);
  border-color: color-mix(in srgb, var(--app-border) 55%, oklch(var(--p)) 45%);
}

.theme-option.active {
  border-color: oklch(var(--p));
  background: color-mix(in srgb, var(--app-surface) 84%, oklch(var(--p)) 16%);
  color: oklch(var(--bc));
}
</style>
