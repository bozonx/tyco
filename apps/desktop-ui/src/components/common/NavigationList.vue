<template>
  <nav
    class="navigation-list"
    :class="{ 'navigation-list--collapsed': isCollapsed }"
    :aria-label="label"
  >
    <ul>
      <li v-for="item in items" :key="item.id">
        <button
          type="button"
          class="navigation-item"
          :class="{
            'is-active': item.id === modelValue,
            'is-nested': item.nested,
          }"
          :aria-current="item.id === modelValue ? 'page' : undefined"
          :aria-label="item.name"
          :title="item.name"
          @click="emit('update:modelValue', item.id)"
        >
          <Icon
            v-if="item.icon"
            :icon="item.icon"
            :height="item.nested ? 14 : 16"
            class="shrink-0"
            aria-hidden="true"
          />
          <span class="navigation-label truncate">{{ item.name }}</span>
          <Badge
            v-if="item.status"
            class="navigation-status"
            :tone="item.isEnabled ? 'accent' : 'muted'"
            >{{ item.status }}</Badge
          >
        </button>
      </li>
    </ul>
  </nav>
</template>
<script setup lang="ts">
import type { NavigationItem } from '../../lib/ui/navigation-item'
import Icon from './AppIcon.vue'
import Badge from './Badge.vue'

defineProps<{
  items: NavigationItem[]
  modelValue: string | number
  label: string
  isCollapsed?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [key: string | number] }>()
</script>
<style scoped>
.navigation-list {
  container: navigation / inline-size;
}
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
}

.navigation-list--collapsed .navigation-label,
.navigation-list--collapsed .navigation-status {
  display: none;
}
.navigation-list--collapsed .navigation-item {
  justify-content: center;
  padding-inline: var(--space-sm);
}
@container navigation (max-width: 8rem) {
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
