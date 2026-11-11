import { describe, expect, it } from 'vitest'
import {
  deviceScopeInsideEntities,
  isDeviceScopedPath,
  joinUserConfig,
  splitUserConfig,
} from '@tyco/shared'
import cases from '../../../../../packages/shared/fixtures/config-scope.json'

describe('config scopes', () => {
  it.each(cases)('$name', (testCase) => {
    const joined = joinUserConfig(testCase.user, testCase.device)
    expect(joined.config).toEqual(testCase.joined)
    expect(
      [...joined.deviceUnknownPaths].map((path) => path.join('.')).sort()
    ).toEqual(testCase.deviceUnknownPaths.map((path) => path.join('.')).sort())
    expect(splitUserConfig(joined.config, joined.deviceUnknownPaths)).toEqual({
      user: testCase.user,
      device: testCase.device,
    })
  })

  it('tells the fields of this device apart', () => {
    expect(isDeviceScopedPath('hotkeys.quickInput')).toBe(true)
    expect(isDeviceScopedPath('appearance.uiScalePercent')).toBe(true)
    expect(isDeviceScopedPath('appearance.theme')).toBe(false)
    expect(isDeviceScopedPath('commands')).toBe(false)
  })

  it('never marks a field inside an entity as one of this device', () => {
    expect(deviceScopeInsideEntities()).toEqual([])
  })
})
