import limits from './desktop-limits.json' with { type: 'json' }

/** Contract limits shared with Rust through its build script. */
export const {
  MAX_PROFILE_TEMPERATURE,
  MAX_TOOL_STEP_COUNT,
  MAX_CHAT_IMAGES_COUNT,
  MAX_CHAT_IMAGE_SOURCE_BYTES,
  MAX_CHAT_IMAGE_RESPONSE_BYTES,
  MAX_CHAT_IMAGE_DIMENSION,
  MAX_CHAT_IMAGE_PIXELS,
  MAX_CHAT_FILE_BYTES,
  MAX_VAULT_ID_LENGTH,
  FILES_TOOL_GROUP_ID,
} = limits
