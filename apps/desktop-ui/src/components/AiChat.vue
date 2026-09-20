<template>
  <div class="flex flex-col gap-2 h-full">
    <Card class="flex-1">
      <div class="overflow-y-auto">
        <ChatItem
          v-for="(message, index) in chatStore.messages"
          :key="`${message.role}-${index}`"
          :message="message"
        />
        <div
          v-if="chatStore.isGenerating && chatStore.loadingProgress"
          class="text-sm text-gray-500 italic mt-2 px-4 py-2 opacity-70"
        >
          {{ chatStore.loadingProgress }}
        </div>
      </div>
    </Card>

    <Card class="flex flex-col gap-2">
      <div class="flex flex-row gap-2">
        <div class="flex-1 flex flex-row gap-2">
          <Button
            small
            secondary
            v-for="attachment in attachments"
            :key="attachment"
            :title="attachment"
          >
            {{ truncate(attachment, 24) }}
          </Button>
        </div>
        <div v-if="roles && roles.length > 0" class="flex flex-col gap-2">
          <FieldSelect
            :options="roles"
            v-model:value="selectedRole"
            :title="t('chat.role')"
            :disabled="chatStore.isGenerating"
          />
        </div>
      </div>

      <div class="flex flex-row gap-2 items-end">
        <ChatInput :disabled="chatStore.isGenerating" />
        <div class="flex flex-col gap-2">
          <Button
            v-if="!chatStore.isGenerating"
            sm
            square
            @click="sendMessage"
            :title="t('chat.sendMessage')"
          >
            <Icon icon="mdi:send" height="24" />
          </Button>
          <Button
            v-else
            sm
            square
            @click="chatStore.stopGeneration()"
            :title="t('chat.stop')"
          >
            <Icon icon="mdi:stop" height="24" />
          </Button>
          <Button
            sm
            square
            @click="clearInput"
            :title="t('chat.clearInput')"
            :disabled="chatStore.isGenerating"
          >
            <Icon icon="mdi:clear" height="24" />
          </Button>
          <Button
            sm
            square
            @click="voiceInput"
            :title="t('chat.voiceInput')"
            :disabled="chatStore.isGenerating"
          >
            <Icon icon="mdi:microphone" height="24" />
          </Button>
        </div>
      </div>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import { useChatStore } from '../stores/chat'
import { useChatInputStore } from '../stores/chatInput'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { truncate } from '@/lib/squidlet-lib-local'
import { Icon } from '@iconify/vue'

const chatInputStore = useChatInputStore()
const ipcStore = useIpcStore()
const chatStore = useChatStore()
const menuModalsStore = useMenuModalsStore()
const userConfig = computed(() => ipcStore.params?.userConfig)
const attachments = computed(() => chatStore.newChatParams?.attachments || [])
const { t } = useI18n()
const roles = computed<Array<{ id: string; name: string }>>(() =>
  (userConfig.value?.chatRoles || []).map((role: any) => ({
    id: role.name,
    name: truncate(role.name, 16),
  }))
)
const selectedRole = ref<string | undefined>(undefined)

watch(
  () => chatStore.newChatParams?.id,
  (newId) => {
    if (newId) {
      if (chatStore.newChatParams?.initialMessage) {
        chatInputStore.setValue(chatStore.newChatParams.initialMessage)
        // Clear it so it doesn't reappear
        chatStore.newChatParams.initialMessage = ''
      } else {
        chatInputStore.clear()
      }
    }
  }
)

watch(
  () => roles.value,
  (newRoles) => {
    if (!selectedRole.value && newRoles.length > 0) {
      selectedRole.value = newRoles[0].id
    }
  },
  { immediate: true }
)

const sendMessage = async () => {
  const msg = chatInputStore.value.trim()

  if (!msg) return

  const result = await chatStore.sendMessage(
    msg,
    attachments.value,
    (userConfig.value?.chatRoles || []).find(
      (role: any) => role.name === selectedRole.value
    )?.rule || ''
  )

  if (result) {
    chatInputStore.clear()
  }
}

const clearInput = () => {
  chatInputStore.clear()
  chatInputStore.focus()
}

const voiceInput = () => {
  menuModalsStore.nextModal(MenuModals.VOICE_RECOGNITION, {
    onCorrected: (resultText: string) => {
      chatInputStore.setValue(resultText)
      menuModalsStore.closeAll()
    },
  })
}
</script>
