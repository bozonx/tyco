import { describe, expect, it } from 'vitest'

import { listSelectionActions } from './selection-action-list'

describe('listSelectionActions', () => {
  it('lists correction, translations and AI tasks by their slots', () => {
    const entries = listSelectionActions(
      {
        toTranslateLanguages: ['en_US', null, 'es_AR'],
        aiTasks: [null, { name: 'deepEdit', rule: '' }],
      },
      { correction: 'Ctrl+Alt+F' }
    )
    expect(entries).toEqual([
      { id: 'correction', kind: 'correction', defaultShortcut: 'Ctrl+Alt+F' },
      { id: 'translate.0', kind: 'translate', language: 'en_US' },
      { id: 'translate.2', kind: 'translate', language: 'es_AR' },
      { id: 'aiTask.1', kind: 'aiTask', taskName: 'deepEdit' },
    ])
  })
})
