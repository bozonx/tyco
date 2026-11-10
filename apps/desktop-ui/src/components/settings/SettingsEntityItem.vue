<template>
  <div
    class="settings-entity"
    :class="{ 'is-openable': openable && openTarget !== 'title' }"
    @click="handleCardClick"
  >
    <button
      v-if="openable && openTarget !== 'title'"
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
        <span class="settings-entity-title">
          <span class="settings-entity-title-text">{{ title }}</span>
          <InfoTooltip v-if="info" :text="info" class="settings-entity-info" />
        </span>
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
        <span class="settings-entity-title">
          <button
            v-if="openable && openTarget === 'title'"
            type="button"
            class="settings-entity-title-btn"
            @click.stop="emit('open')"
          >
            <span class="settings-entity-title-text">{{ title }}</span>
            <AppIcon
              icon="mdi:open-in-new"
              size="xs"
              class="settings-entity-open-icon"
              aria-hidden="true"
            />
          </button>
          <span v-else class="settings-entity-title-text">{{ title }}</span>
          <InfoTooltip v-if="info" :text="info" class="settings-entity-info" />
        </span>
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
import InfoTooltip from '../common/InfoTooltip.vue'

const props = withDefaults(
  defineProps<{
    icon?: string
    title: string
    description?: string
    info?: string
    iconTone?: 'primary' | 'secondary'
    /**
     * The row opens the entity; trailing content is placed in the actions or
     * default slot
     */
    openable?: boolean
    /**
     * Where the click target is located: the whole card or just the title link
     */
    openTarget?: 'card' | 'title'
  }>(),
  { iconTone: 'primary', openTarget: 'card' }
)
const emit = defineEmits<{ open: [] }>()

function handleCardClick(event: MouseEvent) {
  if (!props.openable || props.openTarget === 'title') return
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

.settings-entity.is-openable:not(:has(select, input, textarea)):hover {
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
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--app-text);
}

.settings-entity-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-entity-title-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  font-weight: 500;
  color: var(--app-text);
  cursor: pointer;
  text-align: start;
  text-decoration: none;
  min-width: 0;
  transition: color var(--transition-fast);
}

.settings-entity-title-btn:hover {
  color: var(--color-primary);
}

.settings-entity-title-btn:hover .settings-entity-title-text {
  text-decoration: underline;
}

.settings-entity-title-btn:focus-visible {
  outline: none;
  color: var(--color-primary);
  text-decoration: underline;
}

.settings-entity-open-icon {
  opacity: 0.6;
  flex-shrink: 0;
  transition: opacity var(--transition-fast);
}

.settings-entity-title-btn:hover .settings-entity-open-icon {
  opacity: 1;
}

.settings-entity-info {
  flex-shrink: 0;
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
