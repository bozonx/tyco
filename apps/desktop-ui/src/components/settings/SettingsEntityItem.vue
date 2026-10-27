<template>
  <div
    class="settings-entity"
    :class="{ 'is-openable': openable }"
    @click="handleCardClick"
  >
    <button
      v-if="openable"
      type="button"
      class="settings-entity-target"
      @click="emit('open')"
    >
      <AppIcon
        v-if="icon"
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
    </button>
    <span v-else class="settings-entity-main">
      <AppIcon
        v-if="icon"
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

    <div
      v-if="$slots.default || $slots.actions"
      class="settings-entity-trailing"
      @click.stop
    >
      <slot />
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '../common/AppIcon.vue'

const props = withDefaults(
  defineProps<{
    icon?: string
    title: string
    description?: string
    iconTone?: 'primary' | 'secondary'
    /**
     * The row opens the entity; trailing content is placed in the actions or
     * default slot
     */
    openable?: boolean
  }>(),
  { iconTone: 'primary' }
)
const emit = defineEmits<{ open: [] }>()

function handleCardClick(event: MouseEvent) {
  if (!props.openable) return
  const target = event.target as HTMLElement | null
  if (
    target?.closest('.settings-entity-trailing') ||
    target?.closest('.settings-entity-target')
  ) {
    return
  }
  emit('open')
}
</script>

<style scoped>
.settings-entity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  font: inherit;
  text-align: start;
  color: inherit;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.settings-entity.is-openable {
  cursor: pointer;
}

.settings-entity.is-openable:hover {
  background-color: var(--app-hover);
  border-color: var(--app-border);
}

.settings-entity.is-openable:has(.settings-entity-target:focus-visible) {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: var(--app-focus-ring);
}

.settings-entity-main,
.settings-entity-target {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
  text-align: start;
}

.settings-entity-target {
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.settings-entity-target:focus-visible {
  outline: none;
}

.settings-entity-icon {
  flex-shrink: 0;
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
  gap: 2px;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-entity-trailing {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}
</style>
