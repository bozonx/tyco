<template>
  <Icon
    v-if="resolvedIcon"
    :icon="resolvedIcon"
    :width="sizeLength"
    :height="sizeLength"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { pluginIcons } from '../../lib/plugins/plugin-icons'
import { type IconSize, iconSizeLength } from '../../lib/ui/icon-size'
import { Icon } from '@iconify/vue'

const props = defineProps<{ icon?: string; size?: IconSize }>()
const resolvedIcon = computed(() =>
  props.icon?.startsWith('tyco-p')
    ? pluginIcons.resolve(props.icon)
    : props.icon
)
// Without a size the icon is 1em and follows the surrounding text.
const sizeLength = computed(() =>
  props.size ? iconSizeLength(props.size) : undefined
)
</script>
