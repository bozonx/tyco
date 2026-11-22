import type { AiProfile } from '@tyco/shared'

import type { ChatToolAlwaysAllowTarget } from '../chat-tools/chat-tool-registry'
import { withToolState } from '../chat-tools/tool-catalog'
import { withAlwaysAllowedOperations } from './project-access'

/**
 * What "always allow" of a call changes in the profile: the tool's policy
 * becomes `allow`, or the project's permission for the operations of a file
 * call. Only this profile changes; undefined when there is nothing to change,
 * e.g. a project the profile is no longer connected to
 */
export function alwaysAllowedProfilePatch(
  profile: Pick<AiProfile, 'tools' | 'projectPermissions'>,
  target: ChatToolAlwaysAllowTarget
): Partial<Pick<AiProfile, 'tools' | 'projectPermissions'>> | undefined {
  if (target.kind === 'tool')
    return {
      tools: withToolState(
        profile.tools,
        // the risk only matters for the default, which `allow` is compared to
        { source: target.source, name: target.toolName, risk: 'external' },
        'allow'
      ),
    }
  const current = profile.projectPermissions[target.projectId]
  if (!current) return undefined
  return {
    projectPermissions: {
      ...profile.projectPermissions,
      [target.projectId]: withAlwaysAllowedOperations(
        current,
        target.operations
      ),
    },
  }
}
