import type { AiProfile, ToolCatalogSettings } from '@tyco/shared'

import {
  FILES_SOURCE,
  WEB_SOURCE,
  effectiveToolState,
  isSourceAvailable,
  isSourceEnabledInProfile,
} from '../chat-tools/tool-catalog'
import { projectAccessLevelOf } from './project-access'

/** One part of what a profile's agent may do, for the chat header */
export interface ProfileCapabilityPart {
  key: string
  params?: Record<string, string | number>
}

/**
 * What the agent of a profile may do, in short: its workspace and projects, the
 * web, its commands and plugin sources. Only what is on is named
 */
export function profileCapabilities(
  profile: Pick<AiProfile, 'tools' | 'projectPermissions'>,
  catalog: ToolCatalogSettings | undefined,
  /** The plugins with chat tools */
  pluginIds: readonly string[] = []
): ProfileCapabilityPart[] {
  const parts: ProfileCapabilityPart[] = []
  if (isSourceEnabledInProfile(profile.tools, FILES_SOURCE)) {
    parts.push({ key: 'toolPermissions.summaryWorkspace' })
    const levels = Object.values(profile.projectPermissions ?? {}).flatMap(
      (permission) => {
        const level = projectAccessLevelOf(permission)
        return level ? [level] : []
      }
    )
    if (levels.length)
      parts.push({
        key: levels.every((level) => level === 'read')
          ? 'toolPermissions.summaryProjectsRead'
          : 'toolPermissions.summaryProjects',
        params: { count: levels.length },
      })
  }
  const hasWeb = ['web_search', 'web_fetch'].some(
    (name) =>
      effectiveToolState(catalog, profile.tools, {
        source: WEB_SOURCE,
        name,
        risk: 'read',
      }) !== 'off'
  )
  if (hasWeb) parts.push({ key: 'toolPermissions.summaryWeb' })
  const commandCount = profile.tools?.commandIds.length ?? 0
  if (commandCount)
    parts.push({
      key: 'toolPermissions.summaryCommands',
      params: { count: commandCount },
    })
  const plugins = pluginIds.filter((id) => {
    const source = { kind: 'plugin' as const, id }
    return (
      isSourceAvailable(catalog, source) &&
      isSourceEnabledInProfile(profile.tools, source)
    )
  })
  if (plugins.length)
    parts.push({
      key: 'toolPermissions.summaryPlugins',
      params: { count: plugins.length },
    })
  return parts
}
