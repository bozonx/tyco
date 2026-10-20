<template>
  <ScriptActionFields
    v-if="command.toolId === 'script'"
    :command="command"
    @update="(field, value) => emit('update', field, value)"
  />
  <WebhookActionFields
    v-else-if="command.toolId === 'webhook'"
    :command="command"
    @update="(field, value) => emit('update', field, value)"
  />
</template>
<script setup lang="ts">
import ScriptActionFields from './ScriptActionFields.vue'
import WebhookActionFields from './WebhookActionFields.vue'
import type { CommandConfig } from '@tyco/shared'

defineProps<{ command: CommandConfig }>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
</script>
