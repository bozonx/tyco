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
export type LlmProvider =
  | {
      id: string
      type: Exclude<LlmProviderType, 'openaiCompatible'>
      name?: string
      baseUrl?: never
    }
  | {
      id: string
      type: 'openaiCompatible'
      name?: string
      /** E.g. `http://localhost:11434/v1` */
      baseUrl: string
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
  canUseImages: boolean
  /**
   * Whether the model can call tools in the chat; a new model of a custom
   * endpoint starts without them, as local models often cannot call them
   */
  canUseTools: boolean
  /** DeepSeek thinking mode */
  isThinkingEnabled?: boolean
}

/** The LLM tasks that run on a model of their own */
export const LLM_TASKS = [
  'translation',
  'dialogTranslation',
  'voiceCorrection',
  'correction',
  'aiTask',
  'rewrite',
] as const

export type LlmTask = (typeof LLM_TASKS)[number]

/**
 * How the LLM does one task. `modelId` is the model that answers, empty when
 * none is picked. `rule` is what the user adds to the app instructions of the
 * task
 */
export interface LlmTaskConfig {
  modelId: string
  rule: string
}

/** The settings of each LLM task */
export interface LlmTasksConfig {
  /** The model last picked in the "Ask AI" chat; profile chats keep their own */
  chat: LlmTaskConfig & {
    /**
     * Whether the "Ask AI" chat may search and read the web, without asking; on
     * when unset. Profiles and AI commands set their own
     */
    isWebSearchEnabled?: boolean
  }
  correction: LlmTaskConfig
  translation: LlmTaskConfig & {
    /** The review pass, see `TranslationConfig.qualityGate` */
    qualityGateRule: string
  }
  /** The live translation of the dialog: what the other side says */
  dialogTranslation: LlmTaskConfig
  voiceCorrection: LlmTaskConfig
  /** Each AI command has its own prompt, see `AiCommandOperationConfig` */
  aiTask: Pick<LlmTaskConfig, 'modelId'>
  /** Each transformation and styling preset supplies its own prompt */
  rewrite: Pick<LlmTaskConfig, 'modelId'>
}

/** How much attached images are scaled down before a request */
export type LlmImageQuality = 'economy' | 'balanced' | 'original'

export type LlmModelMode = 'all' | 'perTask'

/**
 * Model steps one answer may take when it calls tools, in every chat, quick
 * request and AI command without its own limit
 */
export const DEFAULT_MAX_TOOL_STEPS = 8
/** The most model steps one answer may take */
export const MAX_TOOL_STEPS = 50

/**
 * The step limit of `llm.maxToolSteps`, or the default when it is unset or out
 * of range
 */
export function maxToolStepsOf(
  llm: Pick<LlmConfig, 'maxToolSteps'> | undefined
): number {
  const steps = llm?.maxToolSteps
  return typeof steps === 'number' &&
    Number.isInteger(steps) &&
    steps >= 1 &&
    steps <= MAX_TOOL_STEPS
    ? steps
    : DEFAULT_MAX_TOOL_STEPS
}

export interface LlmConfig {
  providers: LlmProvider[]
  models: LlmModel[]
  modelMode?: LlmModelMode
  commonModelId?: string
  customTaskModels?: Partial<Record<LlmTask, string>>
  tasks: LlmTasksConfig
  /** Applies to every chat, the profile chats included */
  imageQuality: LlmImageQuality
  /**
   * Model steps one answer may take when it calls tools (1 to
   * `MAX_TOOL_STEPS`); `DEFAULT_MAX_TOOL_STEPS` when unset
   */
  maxToolSteps?: number
  /** The model last picked in the quick AI request without a profile */
  quickRequestModelId?: string
}

export const DEFAULT_LLM_CONFIG = configDefaults.llm as LlmConfig
