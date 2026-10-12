import { defineStore } from 'pinia'

import { createChatInputModel } from '../lib/chat/chat-input-model'

export const useChatInputStore = defineStore('chatInput', createChatInputModel)
