import { computed } from 'vue'

import { llmSecretId } from '@tyco/shared'

import { chatModelOptions } from '../lib/chat/chat-llm-selection'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { isSecretUsable } from '../lib/net/secrets'
import { useDesktopStore } from '../stores/desktop'
import { useSecretsStore } from '../stores/secrets'

/** The models the chat can call with the current settings and keys */
export function useChatModelOptions() {
  const desktopStore = useDesktopStore()
  const secretsStore = useSecretsStore()
  return computed(() =>
    chatModelOptions(normalizeLlmConfig(desktopStore.userConfig?.llm), (id) =>
      isSecretUsable(secretsStore.secrets, llmSecretId(id))
    )
  )
}
