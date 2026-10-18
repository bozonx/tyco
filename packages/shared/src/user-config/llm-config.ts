import configDefaults from '../user-config-defaults.json' with { type: 'json' }

/** Provider families the app can talk to; see `@bozonx/ai-kit` */
export type LlmProviderType =
  'google' | 'openrouter' | 'deepseek' | 'openaiCompatible'

/** Providers that always exist once; their id equals their type */
export const BUILTIN_LLM_PROVIDERS = [
  'google',
  'openrouter',
  'deepseek',
] as const

/**
 * One place models are served from. The id doubles as the id of its API key in
 * the Rust-side secret store; keys are never part of this config
 */
export interface LlmProvider {
  id: string
  type: LlmProviderType
  name?: string
  /** Required for `openaiCompatible`, e.g. `http://localhost:11434/v1` */
  baseUrl?: string
}

export interface LlmModel {
  id: string
  /** Id of an `LlmProvider` */
  providerId: string
  /** The provider's own model id */
  providerModelId: string
  name?: string
  temperature?: number
  maxOutputTokens?: number
  contextWindowTokens?: number
  canUseImages?: boolean
  /**
   * Whether the model can call tools in the chat. Unset: yes for the built-in
   * cloud providers, no for a custom endpoint, where local models often cannot
   */
  canUseTools?: boolean
  /** DeepSeek thinking mode */
  isThinkingEnabled?: boolean
}

export const LLM_TASKS = [
  'translation',
  'voiceCorrection',
  'correction',
  'aiTask',
] as const

export type LlmTask = (typeof LLM_TASKS)[number]

export interface LlmConfig {
  providers: LlmProvider[]
  models: LlmModel[]
  /**
   * Model ids per task: the first answers, the rest are its fallbacks. The chat
   * has no chain: it runs on the model picked in it
   */
  taskModelChains: Record<LlmTask, string[]>
}

export const DEFAULT_LLM_CONFIG = configDefaults.llm as LlmConfig
