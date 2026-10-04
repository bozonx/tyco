<template>
  <section class="settings-section">
    <header
      v-if="title || description || $slots.actions"
      class="settings-section-header"
    >
      <div class="min-w-0">
        <h3 v-if="title" class="settings-section-title">
          <span>{{ title }}</span>
          <InfoTooltip v-if="info" :text="info" />
        </h3>
        <p v-if="description" class="settings-section-description">
          {{ description }}
        </p>
      </div>
      <div v-if="$slots.actions" class="flex items-center gap-2 shrink-0">
        <slot name="actions" />
      </div>
    </header>
    <div :class="{ 'settings-section-body surface': !bare }">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import InfoTooltip from './InfoTooltip.vue'

withDefaults(
  defineProps<{
    title?: string
    description?: string
    info?: string
    bare?: boolean
  }>(),
  { title: '', description: '', info: '', bare: false }
)
</script>

<style scoped>
.settings-section + .settings-section {
  margin-top: var(--space-2xl);
}

.settings-section-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-lg);
  margin-bottom: var(--space-sm);
  padding: 0 var(--space-xs);
}

.settings-section-title {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
  margin: 0;
}

.settings-section-description {
  margin: 2px 0 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--app-text-muted);
  white-space: pre-line;
}

.settings-section-body {
  overflow: hidden;
  box-shadow: var(--app-shadow-sm);
}
</style>
