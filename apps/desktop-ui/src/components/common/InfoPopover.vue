<template>
  <InfoBubble v-bind="props" interactive>
    <template v-if="$slots.default" #default><slot /></template>
  </InfoBubble>
</template>
<script setup lang="ts">
import type { InfoBubbleProps } from '../../lib/ui/info-bubble'
import InfoBubble from './InfoBubble.vue'

const props = withDefaults(defineProps<InfoBubbleProps>(), { teleport: true })
</script>
