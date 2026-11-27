import type { ToolPolicy, ToolRisk } from '@tyco/shared'

import { FILE_TOOL_CATALOG } from './file-tools'
import {
  FILES_SOURCE,
  WEB_SOURCE,
  type CatalogTool,
  type ToolSourceRef,
} from './tool-catalog'

/** A tool as the settings list it */
export interface CatalogToolEntry extends CatalogTool {
  labelKey?: string
  label?: string
}

/** A source as the settings list it */
export interface CatalogSourceEntry {
  source: ToolSourceRef
  labelKey?: string
  label?: string
  descriptionKey?: string
  description?: string
  icon: string
  tools: readonly CatalogToolEntry[]
  /** The permissions of a plugin, shown with its tools */
  capabilities?: readonly string[]
  /** A plugin that does not come with Tyco */
  isThirdParty?: boolean
}

/** The built-in sources a profile switches on and off */
export const CORE_CATALOG: readonly CatalogSourceEntry[] = [
  {
    source: FILES_SOURCE,
    labelKey: 'chatTools.files.group',
    descriptionKey: 'chatTools.files.groupHint',
    icon: 'mdi:folder-outline',
    tools: FILE_TOOL_CATALOG.map((tool) => ({ ...tool, source: FILES_SOURCE })),
  },
  {
    source: WEB_SOURCE,
    labelKey: 'chatTools.web.group',
    descriptionKey: 'chatTools.web.groupHint',
    icon: 'mdi:search-web',
    tools: [
      {
        source: WEB_SOURCE,
        name: 'web_search',
        labelKey: 'chatTools.web.searchLabel',
        risk: 'external',
        defaultPolicy: 'allow',
      },
      {
        source: WEB_SOURCE,
        name: 'web_fetch',
        labelKey: 'chatTools.web.fetchLabel',
        risk: 'external',
        defaultPolicy: 'allow',
      },
    ],
  },
]

/** The i18n key of a risk's name */
export const TOOL_RISK_LABEL_KEYS: Record<ToolRisk, string> = {
  read: 'toolPermissions.riskRead',
  write: 'toolPermissions.riskWrite',
  destructive: 'toolPermissions.riskDestructive',
  external: 'toolPermissions.riskExternal',
}

/** The i18n key of a policy's name */
export const TOOL_POLICY_LABEL_KEYS: Record<ToolPolicy, string> = {
  ask: 'settings.accessAsk',
  allow: 'settings.accessAllow',
}
