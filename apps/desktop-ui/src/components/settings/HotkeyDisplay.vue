<template>
  <span class="hotkey-display">
    <template v-if="groups.length > 0">
      <span
        v-for="(keys, group) in groups"
        :key="group"
        class="hotkey-display-group"
      >
        <template v-for="(key, index) in keys" :key="index">
          <span v-if="index > 0" class="hotkey-display-plus">+</span>
          <KeyboardKey>{{ key }}</KeyboardKey>
        </template>
      </span>
    </template>
    <span v-else class="hotkey-display-empty">{{ placeholder }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import {
  keyLabelFor,
  shortcutAlternatives,
  shortcutKeys,
} from '../../lib/hotkeys/hotkey-recorder'
import KeyboardKey from '../common/KeyboardKey.vue'
import type { HotkeyPlatform } from '@tyco/shared'

/** Shows a shortcut as keys, without a way to change it. */
const props = withDefaults(
  defineProps<{
    shortcut: string
    placeholder?: string
    platform?: HotkeyPlatform
  }>(),
  { placeholder: '', platform: 'linux' }
)

const groups = computed(() =>
  shortcutAlternatives(props.shortcut)
    .map(shortcutKeys)
    .filter((keys) => keys.length > 0)
    .map((keys) => keys.map((key) => keyLabelFor(key, props.platform)))
)
</script>

<style scoped>
.hotkey-display {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}

.hotkey-display-group {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.hotkey-display-plus {
  color: var(--app-text-faint);
  font-size: var(--text-caption);
}

.hotkey-display-empty {
  color: var(--app-text-muted);
  font-size: var(--text-control);
}
</style>
