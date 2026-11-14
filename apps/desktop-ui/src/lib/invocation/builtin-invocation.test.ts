import { describe, expect, it, vi } from 'vitest'

import { createOperationRegistry } from '../operations/operation-registry'
import { TEXT_INPUT_SCHEMA } from '../operations/operation-types'
import { builtinInvocation } from './builtin-invocation'

const tools = createOperationRegistry([
  {
    id: 'core.echo',
    labelKey: 'operations.echo',
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
      operationId: 'core.echo',
      operationConfig: { language: 'de' },
      label: '<operations.echo>',
    })
  })

  it('falls back to the id of a tool that is not registered', () => {
    expect(builtinInvocation('core.gone', tools, t).label).toBe('core.gone')
  })
})
