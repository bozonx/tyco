<template>
  <Button size="sm" @click="browse">{{ t('settings.fastNote.browse') }}</Button>
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'

const emit = defineEmits<{ select: [path: string] }>()
const { t } = useI18n()
const ipc = useIpcStore()
async function browse() {
  const result = await ipc.callFunctionOrNotify('pickDirectory', [])
  if (typeof result.result === 'string') emit('select', result.result)
}
</script>
