import type { LlmConfig, LlmModel } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { modelRequestOptions } from './llm-model-request'

const config = (type: string) =>
  ({ providers: [{ id: 'p', type }] }) as unknown as LlmConfig
const model = (patch: Partial<LlmModel> = {}) =>
  ({ id: 'm', providerId: 'p', providerModelId: 'x', ...patch }) as LlmModel

describe('modelRequestOptions', () => {
  it('leaves the output unlimited without a cap', () => {
    expect(modelRequestOptions(config('openai'), model(), {})).toEqual({})
  })

  it('takes the lower cap and the call temperature first', () => {
    expect(
      modelRequestOptions(
        config('openai'),
        model({ maxOutputTokens: 500, temperature: 0.2 }),
        { maxOutputTokens: 100, temperature: 0.7 }
      )
    ).toEqual({ maxOutputTokens: 100, temperature: 0.7 })
  })

  it('drops the temperature of a thinking DeepSeek model', () => {
    expect(
      modelRequestOptions(
        config('deepseek'),
        model({ providerModelId: 'deepseek-reasoner', temperature: 1 }),
        {}
      )
    ).toEqual({
      providerOptions: { deepseek: { thinking: { type: 'enabled' } } },
    })
  })
})
