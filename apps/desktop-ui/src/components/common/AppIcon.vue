<template>
  <Icon v-if="resolvedIcon" :icon="resolvedIcon" />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { pluginIcons } from '../../lib/plugins/plugin-icons'
import { Icon } from '@iconify/vue'

const props = defineProps<{ icon?: string }>()
const resolvedIcon = computed(() =>
  props.icon?.startsWith('tyco-p')
    ? pluginIcons.resolve(props.icon)
    : props.icon
)
</script>
