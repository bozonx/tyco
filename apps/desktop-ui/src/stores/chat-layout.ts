import { defineStore } from 'pinia'

import { createChatLayoutModel } from '../lib/chat/chat-layout-model'

export const useChatLayoutStore = defineStore(
  'chatLayout',
  createChatLayoutModel
)
