import type {
  ActionItem as SdkActionItem,
  EditItem as SdkEditItem,
  ToolbarItem as SdkToolbarItem,
  PluginDefinition,
} from '@tyco/plugin-sdk'
export * from '@tyco/plugin-sdk'

export type PluginFactory = () => PluginDefinition & {
  name: string
  _revision?: string
  _loadError?: string
  _incompatible?: boolean
  _external?: boolean
  _canRestore?: boolean
}

export type { ContributionOwner } from '../lib/plugins/contribution-registry'
import type { ContributionOwner } from '../lib/plugins/contribution-registry'
export type ActionItem = SdkActionItem & ContributionOwner
export type EditItem = SdkEditItem & ContributionOwner
export type ToolbarItem = SdkToolbarItem & ContributionOwner
