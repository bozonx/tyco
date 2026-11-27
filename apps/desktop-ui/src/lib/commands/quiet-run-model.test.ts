import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_CONFIG, type QuietRunEvent } from '@tyco/shared'

import { createCommand } from './command-config'
import { createQuietRunModel } from './quiet-run-model'

const event: QuietRunEvent = {
  jobId: 'job',
  commandName: 'Backup',
  state: 'accepted',
  startedAt: null,
}

function setup(text?: string) {
  const command = createCommand('webhook', 'backup')
  const deps = {
    claim: vi.fn(async () => ({
      commandId: command.id,
      userConfig: { ...DEFAULT_USER_CONFIG, commands: [command] },
      text,
    })),
    run: vi.fn(async () => ({ success: true, output: 'done' })),
    finish: vi.fn(async () => undefined),
    takesText: vi.fn(() => true),
  }
  return { deps, model: createQuietRunModel(deps) }
}

describe('quiet command runs', () => {
  it('returns output and never requests missing input', async () => {
    const { deps, model } = setup()
    await model.run(event)
    expect(deps.run).not.toHaveBeenCalled()
    expect(deps.finish).toHaveBeenCalledExactlyOnceWith('job', {
      success: false,
      code: 'InputRequired',
      message: expect.any(String),
    })
  })

  it('uses return output and claims a duplicate start only once', async () => {
    const { deps, model } = setup('text')
    await Promise.all([model.run(event), model.run(event)])
    expect(deps.claim).toHaveBeenCalledTimes(1)
    expect(deps.run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'backup' }),
      'text',
      expect.objectContaining({ output: 'return', isQuiet: true })
    )
    expect(deps.finish).toHaveBeenCalledExactlyOnceWith('job', {
      success: true,
      output: 'done',
    })
  })
})
