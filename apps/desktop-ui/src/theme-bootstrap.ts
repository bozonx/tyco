/**
 * Applies the persisted appearance before the app renders to avoid a flash of
 * the wrong theme or scale. Loaded as a module script from `index.html`, so it
 * must not import anything that pulls in the application bundle.
 */
import {
  applyAppearanceToDocument,
  readStoredAppearance,
  readSystemAppearance,
} from './lib/theme/document-appearance'
import { DEFAULT_APPEARANCE, resolveAppearance } from '@tyco/shared/appearance'

const settings = readStoredAppearance(window.localStorage) ?? DEFAULT_APPEARANCE

applyAppearanceToDocument(
  document.documentElement,
  resolveAppearance(settings, readSystemAppearance())
)
