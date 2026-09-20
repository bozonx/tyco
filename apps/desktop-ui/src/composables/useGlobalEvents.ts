import { IndexedEventEmitter } from "@/lib/squidlet-lib-local";

const globalEvents = new IndexedEventEmitter();

export enum GlobalEvents {
  VOICE_RECOGNITION = "voice-recognition",
  KEY_UP = "key-up",
  INITED = "inited",
}

export const useGlobalEvents = () => {
  return {
    globalEvents,
  };
};
