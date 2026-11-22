import { describe, expect, it } from 'vitest'

import {
  hasFileToolsOff,
  isDeleteAllowed,
  normalizedProjectPermission,
  PROJECT_ACCESS_LEVELS,
  projectAccessLevelOf,
  projectPermissionFor,
  withAlwaysAllowedOperations,
  withProjectAccess,
  withProjectDeleteAllowed,
} from './project-access'

describe('project access levels', () => {
  it('round-trips every level', () => {
    for (const level of PROJECT_ACCESS_LEVELS) {
      expect(projectAccessLevelOf(projectPermissionFor(level))).toBe(level)
    }
  })

  it('expands the presets into read, write and delete', () => {
    expect(projectPermissionFor('read')).toEqual({
      read: 'allow',
      write: 'deny',
      delete: 'deny',
    })
    expect(projectPermissionFor('readWrite')).toEqual({
      read: 'allow',
      write: 'ask',
      delete: 'ask',
    })
    expect(projectPermissionFor('full')).toEqual({
      read: 'allow',
      write: 'allow',
      delete: 'ask',
    })
  })

  it('deletes without asking only where writing does not ask', () => {
    expect(projectPermissionFor('full', true).delete).toBe('allow')
    expect(projectPermissionFor('readWrite', true).delete).toBe('ask')
    expect(projectAccessLevelOf(projectPermissionFor('full', true))).toBe(
      'full'
    )
    expect(isDeleteAllowed(projectPermissionFor('full', true))).toBe(true)
    const permissions = { docs: projectPermissionFor('readWrite') }
    expect(withProjectDeleteAllowed(permissions, 'docs', true)).toEqual(
      permissions
    )
    const full = { docs: projectPermissionFor('full') }
    expect(withProjectDeleteAllowed(full, 'docs', true).docs?.delete).toBe(
      'allow'
    )
    expect(withProjectDeleteAllowed(full, 'docs', false).docs?.delete).toBe(
      'ask'
    )
  })

  it('keeps deleting no freer than writing', () => {
    expect(
      normalizedProjectPermission({
        read: 'allow',
        write: 'ask',
        delete: 'allow',
      }).delete
    ).toBe('ask')
    expect(
      normalizedProjectPermission({
        read: 'allow',
        write: 'deny',
        delete: 'allow',
      }).delete
    ).toBe('deny')
  })

  it('raises the operations "always allowed" from a call', () => {
    const readWrite = projectPermissionFor('readWrite')
    expect(withAlwaysAllowedOperations(readWrite, ['write'])).toEqual({
      read: 'allow',
      write: 'allow',
      delete: 'ask',
    })
    expect(withAlwaysAllowedOperations(readWrite, ['write', 'delete'])).toEqual(
      { read: 'allow', write: 'allow', delete: 'allow' }
    )
    // deleting alone cannot outrun writing
    expect(withAlwaysAllowedOperations(readWrite, ['delete']).delete).toBe(
      'ask'
    )
  })

  it('shows permissions that match no level as custom', () => {
    expect(projectAccessLevelOf(undefined)).toBeUndefined()
    expect(
      projectAccessLevelOf({ read: 'deny', write: 'deny', delete: 'deny' })
    ).toBe(undefined)
    for (const permission of [
      { read: 'ask', write: 'ask', delete: 'ask' },
      { read: 'ask', write: 'deny', delete: 'deny' },
      { read: 'deny', write: 'allow', delete: 'ask' },
      { read: 'allow', write: 'ask', delete: 'deny' },
    ] as const)
      expect(projectAccessLevelOf(permission)).toBe('custom')
  })

  it('keeps a custom permission as it is', () => {
    const custom = {
      docs: { read: 'ask', write: 'allow', delete: 'ask' },
    } as const
    expect(withProjectAccess(custom, 'docs', 'custom')).toEqual(custom)
  })

  it('connects and removes one project, keeping the others', () => {
    const start = { docs: projectPermissionFor('read') }
    const connected = withProjectAccess(start, 'site', 'full')
    expect(connected).toEqual({
      docs: projectPermissionFor('read'),
      site: projectPermissionFor('full'),
    })
    expect(withProjectAccess(connected, 'docs', undefined)).toEqual({
      site: projectPermissionFor('full'),
    })
    expect(start).toEqual({ docs: projectPermissionFor('read') })
  })

  it('tells when the file tools are off', () => {
    expect(hasFileToolsOff({})).toBe(false)
    expect(
      hasFileToolsOff({
        tools: {
          sources: { 'core:files': { isEnabled: false } },
          tools: {},
          commandIds: [],
        },
      })
    ).toBe(true)
  })
})
