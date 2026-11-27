import type { AiProfile, ToolCatalogSettings } from '@tyco/shared'

import {
  COMMANDS_SOURCE,
  FILES_SOURCE,
  WEB_SOURCE,
  effectiveToolState,
  isCommandPicked,
  isSourceAvailable,
  isSourceEnabledInProfile,
} from '../chat-tools/tool-catalog'
import { effectiveProjectAccessLevel } from './project-access'

/** What the profile may reach besides its settings */
export interface ProfileCapabilityContext {
  /** The plugins with chat tools */
  pluginIds?: readonly string[]
  /** The projects of the profile's workspace */
  projectIds?: readonly string[]
  /** The commands a chat may be offered */
  commandIds?: readonly string[]
}

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
  context: ProfileCapabilityContext = {}
): ProfileCapabilityPart[] {
  const { pluginIds = [], projectIds = [], commandIds = [] } = context
  const parts: ProfileCapabilityPart[] = []
  if (isSourceAvailable(catalog, FILES_SOURCE)) {
    parts.push({ key: 'toolPermissions.summaryWorkspace' })
    const levels = projectIds.flatMap((projectId) => {
      const level = effectiveProjectAccessLevel(
        profile.projectPermissions,
        projectId
      )
      return level ? [level] : []
    })
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
  const commandCount =
    isSourceAvailable(catalog, COMMANDS_SOURCE) &&
    isSourceEnabledInProfile(profile.tools, COMMANDS_SOURCE)
      ? commandIds.filter((id) => isCommandPicked(profile.tools, id)).length
      : 0
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
