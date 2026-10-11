import { describe, expect, it, vi } from 'vitest'

import { createAccessPrompt } from './access-prompt'

describe('createAccessPrompt', () => {
  it('answers each request once', () => {
    const answer = vi.fn(async () => {})
    const prompt = createAccessPrompt({ answer })

    prompt.respond('job-1', 'once')
    prompt.respond('job-1', 'always')
    prompt.dismiss('job-1')

    expect(answer).toHaveBeenCalledTimes(1)
    expect(answer).toHaveBeenCalledWith('job-1', 'once')
    expect(prompt.isAnswered('job-1')).toBe(true)
  })

  it('denies a request the prompt left without an answer', () => {
    const answer = vi.fn(async () => {})
    const prompt = createAccessPrompt({ answer })

    prompt.dismiss('job-1')
    prompt.respond('job-2', 'always')

    expect(answer.mock.calls).toEqual([
      ['job-1', 'deny'],
      ['job-2', 'always'],
    ])
  })

  it('ignores a prompt without a request', () => {
    const answer = vi.fn(async () => {})
    const prompt = createAccessPrompt({ answer })

    prompt.respond(undefined, 'once')
    prompt.dismiss(undefined)

    expect(answer).not.toHaveBeenCalled()
    expect(prompt.isAnswered(undefined)).toBe(false)
  })

  it('swallows a failed answer', async () => {
    const answer = vi.fn(async () => {
      throw new Error('IPC is gone')
    })
    const prompt = createAccessPrompt({ answer })

    expect(() => prompt.respond('job-1', 'once')).not.toThrow()
    await Promise.resolve()
    expect(answer).toHaveBeenCalledOnce()
  })
})
