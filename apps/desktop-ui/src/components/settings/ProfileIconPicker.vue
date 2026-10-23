<template>
  <div class="profile-icon-picker" role="radiogroup" :aria-label="label">
    <IconButton
      v-for="icon in PROFILE_ICONS"
      :key="icon"
      role="radio"
      :aria-checked="icon === modelValue"
      :active="icon === modelValue"
      :icon="icon"
      :label="label"
      :title="icon.slice('mdi:'.length)"
      @click="emit('update:modelValue', icon)"
    />
  </div>
</template>

<script setup lang="ts">
import { PROFILE_ICONS } from '../../lib/ai-profiles/profile-icons'
import IconButton from '../common/IconButton.vue'

defineProps<{ modelValue: string; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [icon: string] }>()
</script>

<style scoped>
.profile-icon-picker {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}
</style>
