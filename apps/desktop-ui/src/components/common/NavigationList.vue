<template>
  <nav
    class="navigation-list"
    :class="{ 'navigation-list--compact': compact }"
    :aria-label="label"
  >
    <ul>
      <li v-for="item in items" :key="item.key">
        <button
          type="button"
          class="navigation-item"
          :class="{
            'is-active': item.key === modelValue,
            'is-nested': item.nested,
          }"
          :aria-current="item.key === modelValue ? 'page' : undefined"
          :aria-label="item.text"
          :title="item.text"
          @click="emit('update:modelValue', item.key)"
        >
          <Icon
            v-if="item.icon"
            :icon="item.icon"
            :height="item.nested ? 14 : 16"
            class="shrink-0"
            aria-hidden="true"
          />
          <span class="navigation-label truncate">{{ item.text }}</span>
          <span
            v-if="item.status"
            class="navigation-status"
            :class="{ 'is-enabled': item.isEnabled }"
            >{{ item.status }}</span
          >
        </button>
      </li>
    </ul>
  </nav>
</template>
<script setup lang="ts">
import type { NavigationItem } from '../../lib/ui/navigation-item'
import Icon from './AppIcon.vue'

defineProps<{
  items: NavigationItem[]
  modelValue: string | number
  label: string
  compact?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [key: string | number] }>()
</script>
<style scoped>
.navigation-list ul {
  display: flex;
  flex-direction: column;
  gap: var(--segment-gap);
  margin: 0;
  padding: 0;
  list-style: none;
}
.navigation-item {
  display: flex;
  align-items: center;
  gap: 0.4375rem;
  width: 100%;
  min-width: 0;
  padding: 0.4375rem 0.625rem;
  border-radius: var(--radius-md);
  font-size: var(--text-body);
  font-weight: 500;
  line-height: 1.25;
  color: var(--app-text-muted);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}
.navigation-item:hover {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}
.navigation-item.is-active {
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}
.navigation-item.is-nested {
  padding-left: var(--space-2xl);
  font-size: var(--text-control);
}
.navigation-status {
  margin-left: auto;
  padding: 0.0625rem 0.3125rem;
  border-radius: var(--radius-sm);
  font-size: var(--text-micro);
  font-weight: 600;
  line-height: 1.2;
  background-color: var(--app-hover);
  color: var(--app-text-faint);
}
.navigation-status.is-enabled {
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}
.navigation-list--compact .navigation-label,
.navigation-list--compact .navigation-status {
  display: none;
}
.navigation-list--compact .navigation-item {
  justify-content: center;
  padding-inline: var(--space-sm);
}
@media (max-width: 45rem) {
  .navigation-label,
  .navigation-status {
    display: none;
  }
  .navigation-item {
    justify-content: center;
    padding-inline: var(--space-sm);
  }
}
</style>
