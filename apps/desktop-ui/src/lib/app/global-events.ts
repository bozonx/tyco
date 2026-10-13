export enum GlobalEvents {
  KEY_UP = 'key-up',
  INITED = 'inited',
  /** Finishes the open voice input and sends the result to the chat */
  VOICE_SUBMIT = 'voice-submit',
}

export interface GlobalEventArgs {
  [GlobalEvents.KEY_UP]: [event: KeyboardEvent]
  [GlobalEvents.INITED]: []
  [GlobalEvents.VOICE_SUBMIT]: []
}

export type GlobalEventEmit = <K extends keyof GlobalEventArgs>(
  event: K,
  ...args: GlobalEventArgs[K]
) => void
