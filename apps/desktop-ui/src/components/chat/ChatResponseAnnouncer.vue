<template>
  <div role="status" aria-atomic="true" class="sr-only">{{ announcement }}</div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import type { ChatMessage } from '@tyco/shared'

const props = defineProps<{
  chatId?: string
  isGenerating: boolean
  message?: ChatMessage
}>()
const announcement = ref('')

watch(
  () => [props.chatId, props.isGenerating] as const,
  ([chatId, isGenerating], [previousChatId, wasGenerating]) => {
    announcement.value = ''
    if (
      chatId === previousChatId &&
      wasGenerating &&
      !isGenerating &&
      props.message?.role === 'assistant'
    ) {
      announcement.value = props.message.content
    }
  },
  { flush: 'post' }
)
</script>
