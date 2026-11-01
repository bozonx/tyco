import { describeError } from '../lib/errors/describe-error'
import { translate } from '../lib/i18n'
import { createUserDataFolderModel } from '../lib/storage/user-data-folder-model'
import { useUserDataStore } from '../stores/user-data'

/**
 * A model to change the data folder with; `flushDrafts` saves what the window
 * has not saved yet, before the app restarts
 */
export function useUserDataFolder(flushDrafts: () => Promise<boolean>) {
  const store = useUserDataStore()
  return createUserDataFolderModel({
    inspect: store.inspect,
    relocate: store.relocate,
    pickFolder: store.pickFolder,
    flushDrafts,
    describeError: (error) => describeError(error, translate),
    draftsNotSavedMessage: () => translate('settings.userData.draftsNotSaved'),
  })
}
