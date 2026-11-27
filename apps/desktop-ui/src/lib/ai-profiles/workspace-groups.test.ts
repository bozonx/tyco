import { describe, expect, it } from 'vitest'
import type { WorkspaceInfo } from '@tyco/shared'

import { entityLabel, workspaceLabel } from './workspace-groups'

const workspace = (patch: Partial<WorkspaceInfo>): WorkspaceInfo => ({
  workspaceId: '',
  name: '',
  path: '/data/ai-vault',
  isMain: true,
  status: 'connected',
  isWritableByOthers: false,
  chatHistory: {},
  ...patch,
})

const main = workspace({})
const work = workspace({
  workspaceId: 'w1',
  name: 'Work',
  path: '/w',
  isMain: false,
})
const away = workspace({
  workspaceId: 'w2',
  path: '/mnt/usb/Workspace',
  isMain: false,
  status: 'notConnected',
})

describe('workspace groups', () => {
  it('name the workspace only when profile names clash', () => {
    const profiles = [
      { id: 'a', name: 'Assistant' },
      { id: 'w1:b', name: 'Assistant' },
      { id: 'w1:c', name: 'Coder' },
    ]
    const label = (item: (typeof profiles)[number]) =>
      entityLabel(item, profiles, [main, work], 'Main')
    expect(profiles.map(label)).toEqual([
      'Assistant (Main)',
      'Assistant (Work)',
      'Coder',
    ])
    expect(workspaceLabel(away, 'Main')).toBe('Workspace')
  })
})
