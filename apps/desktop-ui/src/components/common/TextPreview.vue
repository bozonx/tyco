<template>
  <pre
    class="selectable"
    :class="{ 'is-plain': resolvedAppearance === 'plain' }"
    >{{ text }}</pre>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'

import {
  type PreviewAppearance,
  previewAppearanceKey,
} from '../../lib/ui/preview-context'

const props = defineProps<{ text?: string; appearance?: PreviewAppearance }>()
const inheritedAppearance = inject(previewAppearanceKey, 'framed')
const resolvedAppearance = computed(
  () => props.appearance ?? inheritedAppearance
)
</script>

<style scoped>
pre {
  min-height: 0;
  flex: 1 1 0%;
  box-sizing: border-box;
  height: 100%;
  width: 100%;
  margin: 0;
  padding: var(--space-md) var(--space-lg);
  overflow-y: auto;
  font-family: var(--font-sans);
  font-size: var(--preview-font-size);
  line-height: var(--preview-line-height);
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-base-content);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-lg);
}

.is-plain {
  border: none;
  border-radius: 0;
  background-color: transparent;
}
</style>
