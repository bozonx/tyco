import { IndexedEventEmitter } from '@/lib/squidlet-lib-local'

const globalEvents = new IndexedEventEmitter()

export enum GlobalEvents {
  KEY_UP = 'key-up',
  INITED = 'inited',
  /** Finishes the open voice input and sends the result to the chat */
  VOICE_SUBMIT = 'voice-submit',
}

export const useGlobalEvents = () => {
  return { globalEvents }
}
