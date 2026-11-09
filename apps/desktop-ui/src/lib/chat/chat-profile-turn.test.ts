import { expect, it, vi } from 'vitest'

import { profileTurnOptions } from './chat-profile-turn'

it('asks for the tools of the profile and adds its call settings', async () => {
  const turnTools = vi.fn(async () => ({ canUseTools: true, tools: undefined }))

  const options = await profileTurnOptions({ turnTools }, 'gpt-4', 1000, {
    tools: { maxStepCount: 3 },
    memoryMode: 'read',
    temperature: 0.2,
    maxOutputTokens: 500,
  } as never)

  expect(turnTools).toHaveBeenCalledWith(
    'gpt-4',
    1000,
    { maxStepCount: 3 },
    'read'
  )
  expect(options).toEqual({
    canUseTools: true,
    tools: undefined,
    temperature: 0.2,
    maxOutputTokens: 500,
  })
})

it('leaves the call settings out without a profile', async () => {
  const turnTools = vi.fn(async () => ({
    canUseTools: false,
    tools: undefined,
  }))

  expect(
    await profileTurnOptions({ turnTools }, 'gpt-4', undefined, undefined)
  ).toMatchObject({ temperature: undefined, maxOutputTokens: undefined })
  expect(turnTools).toHaveBeenCalledWith(
    'gpt-4',
    undefined,
    undefined,
    undefined
  )
})
