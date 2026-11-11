import { defineStore } from 'pinia'
import { createDictationHandoff } from '../lib/stt/dictation-handoff'

export const useDictationHandoffStore = defineStore('dictationHandoff', () =>
  createDictationHandoff()
)
