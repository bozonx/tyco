<template>
  <component
    :is="openable ? 'button' : 'div'"
    :type="openable ? 'button' : undefined"
    class="settings-entity"
    :class="{ 'is-openable': openable }"
    @click="openable && emit('open')"
  >
    <span class="settings-entity-main">
      <AppIcon
        :icon="icon"
        size="lg"
        class="settings-entity-icon"
        :class="`is-${iconTone}`"
        aria-hidden="true"
      />
      <span class="settings-entity-copy">
        <span class="settings-entity-title">{{ title }}</span>
        <span v-if="description" class="settings-entity-description">
          {{ description }}
        </span>
      </span>
    </span>
    <span v-if="$slots.default" class="settings-entity-trailing">
      <slot />
    </span>
    <AppIcon
      v-if="openable"
      icon="mdi:chevron-right"
      size="lg"
      class="settings-entity-chevron"
      aria-hidden="true"
    />
  </component>
</template>

<script setup lang="ts">
import AppIcon from '../common/AppIcon.vue'

withDefaults(
  defineProps<{
    icon: string
    title: string
    description?: string
    iconTone?: 'primary' | 'secondary'
    /** The row opens the entity; trailing content must not be interactive */
    openable?: boolean
  }>(),
  { iconTone: 'primary' }
)
const emit = defineEmits<{ open: [] }>()
</script>

<style scoped>
.settings-entity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  width: 100%;
  padding: var(--space-md);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  font: inherit;
  text-align: start;
  color: inherit;
}

.settings-entity.is-openable {
  flex-wrap: nowrap;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.settings-entity.is-openable:hover {
  background-color: var(--app-hover);
  border-color: var(--app-border);
}

.settings-entity.is-openable:focus-visible {
  outline: none;
  box-shadow: var(--app-focus-ring);
}

.settings-entity-main {
  display: flex;
  flex: 1;
  align-items: flex-start;
  gap: var(--space-sm);
  min-width: 0;
}

.settings-entity-icon {
  flex-shrink: 0;
  margin-top: var(--space-2xs);
}

.settings-entity-icon.is-primary {
  color: var(--color-primary);
}

.settings-entity-icon.is-secondary {
  color: var(--color-secondary);
}

.settings-entity-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.settings-entity-title {
  overflow: hidden;
  font-size: var(--text-body);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-entity-description {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.settings-entity-trailing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
}

.settings-entity-chevron {
  flex-shrink: 0;
  color: var(--app-text-faint);
}
</style>
