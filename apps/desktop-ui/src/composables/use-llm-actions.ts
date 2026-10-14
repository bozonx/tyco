import { useLlmStore } from '../stores/llm'

/** Vue adapter for the window's configured application service. */
export const useLlmActions = () => useLlmStore().actions
