import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  deviceScopeInsideEntities,
  deviceScopedPaths,
  isDeviceScopedPath,
  joinUserConfig,
  splitUserConfig,
} from '@tyco/shared'
import cases from '../../../../../packages/shared/fixtures/config-scope.json'

/**
 * Where the settings tell that each field of this device is not synced: the
 * component and the marker it carries. `null`: the field has no visible
 * setting
 */
const DEVICE_FIELD_NOTES: Record<
  string,
  [file: string, marker: string] | null
> = {
  isInDevelopment: null,
  // where the subtitles strip was last; no setting of its own
  'dialog.compactGeometry': null,
  'appearance.uiScalePercent': [
    'SettingsAccessibilityTab.vue',
    `:label="t('settings.uiScale')" device-scoped`,
  ],
  hotkeys: ['SettingsGlobalActionsTab.vue', 'hotkeysDeviceScopedHint'],
  externalAccess: ['SettingsCommandsTab.vue', 'device-scoped'],
  windowInsertion: ['SettingsGeneralTab.vue', 'device-scoped'],
  variableValues: ['SettingsVariablesTab.vue', `t('variables.hint'`],
  'aiVaults.attached': [
    'SettingsWorkspaceSection.vue',
    'attachedDeviceScopedHint',
  ],
  'stt.microphoneId': [
    'SettingsVoiceTab.vue',
    ':error="micTestError"\n        device-scoped',
  ],
  'stt.listenAppId': null,
  'stt.listenAppLabel': null,
  'stt.isListenMicrophoneMixed': null,
  'stt.providers.sherpaOnnx': [
    'SettingsVoiceTab.vue',
    ':error="sttServerUrlError"\n        device-scoped',
  ],
}

const settingsSource = (file: string) =>
  readFileSync(
    new URL(`../../components/settings/${file}`, import.meta.url),
    'utf8'
  )

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

  it('says in the settings which fields are not synced', () => {
    expect(deviceScopedPaths().sort()).toEqual(
      Object.keys(DEVICE_FIELD_NOTES).sort()
    )
    for (const note of Object.values(DEVICE_FIELD_NOTES)) {
      if (note) expect(settingsSource(note[0])).toContain(note[1])
    }
  })

  it('never marks a field inside an entity as one of this device', () => {
    expect(deviceScopeInsideEntities()).toEqual([])
  })
})
