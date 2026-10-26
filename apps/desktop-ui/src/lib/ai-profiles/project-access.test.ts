import { describe, expect, it } from 'vitest'

import {
  hasFileToolsOff,
  PROJECT_ACCESS_LEVELS,
  projectAccessLevelOf,
  projectPermissionFor,
  withProjectAccess,
} from './project-access'
import { FILES_TOOL_GROUP_ID } from '../chat-tools/chat-tool-groups'

describe('project access levels', () => {
  it('round-trips every level', () => {
    for (const level of PROJECT_ACCESS_LEVELS) {
      expect(projectAccessLevelOf(projectPermissionFor(level))).toBe(level)
    }
  })

  it('maps older permissions to the closest level', () => {
    expect(projectAccessLevelOf(undefined)).toBeUndefined()
    expect(projectAccessLevelOf({ read: 'deny', write: 'deny' })).toBe(
      undefined
    )
    expect(projectAccessLevelOf({ read: 'ask', write: 'deny' })).toBe('read')
    expect(projectAccessLevelOf({ read: 'ask', write: 'ask' })).toBe(
      'readWriteAsk'
    )
    expect(projectAccessLevelOf({ read: 'deny', write: 'allow' })).toBe('full')
  })

  it('connects and removes one project, keeping the others', () => {
    const start = { docs: projectPermissionFor('read') }
    const connected = withProjectAccess(start, 'site', 'full')
    expect(connected).toEqual({
      docs: { read: 'allow', write: 'deny' },
      site: { read: 'allow', write: 'allow' },
    })
    expect(withProjectAccess(connected, 'docs', undefined)).toEqual({
      site: { read: 'allow', write: 'allow' },
    })
    expect(start).toEqual({ docs: { read: 'allow', write: 'deny' } })
  })

  it('tells when the file tools are off', () => {
    expect(hasFileToolsOff({})).toBe(true)
    expect(
      hasFileToolsOff({
        tools: {
          groups: {
            [FILES_TOOL_GROUP_ID]: { isEnabled: true, access: 'allow' },
          },
        },
      })
    ).toBe(false)
  })
})
