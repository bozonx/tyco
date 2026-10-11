import { describe, expect, it, vi } from 'vitest'

import { createToolRegistry } from '../tools/tool-registry'
import { TEXT_INPUT_SCHEMA } from '../tools/tool-types'
import { builtinInvocation } from './builtin-invocation'

const tools = createToolRegistry([
  {
    id: 'core.echo',
    labelKey: 'tools.echo',
    description: 'Echoes the text',
    inputSchema: TEXT_INPUT_SCHEMA,
    run: vi.fn(),
  },
])
const t = (key: string) => `<${key}>`

describe('builtinInvocation', () => {
  it('names the invocation after its tool', () => {
    expect(
      builtinInvocation('core.echo', tools, t, { language: 'de' })
    ).toEqual({
      toolId: 'core.echo',
      toolConfig: { language: 'de' },
      label: '<tools.echo>',
    })
  })

  it('falls back to the id of a tool that is not registered', () => {
    expect(builtinInvocation('core.gone', tools, t).label).toBe('core.gone')
  })
})
