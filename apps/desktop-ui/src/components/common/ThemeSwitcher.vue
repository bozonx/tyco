<template>
  <div
    class="theme-switcher"
    role="radiogroup"
    :aria-label="t('settings.theme')"
  >
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
      <Icon :icon="option.icon" height="15" />
      <span>{{ option.name }}</span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import type { ThemeMode } from '../../lib/theme/theme-controller'
import { Icon } from '@iconify/vue'

const props = defineProps<{ value: ThemeMode }>()

const emit = defineEmits<{ (e: 'update:value', value: ThemeMode): void }>()

const { t } = useI18n()

const themeOptions = computed(() => [
  { id: 'auto', name: t('theme.auto'), icon: 'mdi:theme-light-dark' },
  { id: 'light', name: t('theme.light'), icon: 'mdi:white-balance-sunny' },
  { id: 'dark', name: t('theme.dark'), icon: 'mdi:weather-night' },
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
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
}

.theme-option {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.3125rem 0.75rem;
  border-radius: calc(var(--radius-md) - 2px);
  color: var(--app-text-muted);
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.25;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.theme-option:hover {
  color: var(--color-base-content);
}

.theme-option.active {
  background-color: var(--app-surface);
  color: var(--color-base-content);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.08),
    0 0 0 1px var(--app-border-subtle);
}

.theme-option:has(:focus-visible) {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
</style>
