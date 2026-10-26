import { AiError } from '@bozonx/ai-kit'
import {
  deeplTranslationProvider,
  googleCloudTranslationProvider,
  type TranslationProviderFactory,
} from '@bozonx/ai-kit/translate'

/** DeepL answers this when the character quota of the plan is used up */
const DEEPL_QUOTA_EXCEEDED_STATUS = 456

/** A depleted subscription is permanent until the user changes its quota. */
export const createDeepLProvider: TranslationProviderFactory = (init) => ({
  async translate(request) {
    let quotaExhausted = false
    const provider = deeplTranslationProvider({
      ...init,
      fetch: async (input, options) => {
        if (!init.fetch) throw new Error('DeepL requires the desktop transport')
        // The SDK strips newer regional variants; the local catalog already
        // resolves and validates the exact provider codes.
        const body = JSON.parse(String(options?.body)) as Record<
          string,
          unknown
        >
        body.target_lang = request.targetLanguage.toUpperCase()
        if (request.sourceLanguage && request.sourceLanguage !== 'auto')
          body.source_lang = request.sourceLanguage.toUpperCase()
        if (request.format === 'html') body.tag_handling = 'html'
        const response = await init.fetch(input, {
          ...options,
          body: JSON.stringify(body),
        })
        quotaExhausted = response.status === DEEPL_QUOTA_EXCEEDED_STATUS
        return response
      },
    })
    try {
      return await provider.translate(request)
    } catch (error) {
      if (quotaExhausted)
        throw new AiError(
          'invalid_request',
          'DeepL translation quota is exhausted; increase the subscription limit before retrying',
          {
            provider: 'deepl',
            status: DEEPL_QUOTA_EXCEEDED_STATUS,
            cause: error,
          }
        )
      throw error
    }
  },
})

/** Preserve the NMT language variants that the SDK reduces to base languages. */
export const createGoogleTranslationProvider: TranslationProviderFactory = (
  init
) => ({
  async translate(request) {
    return googleCloudTranslationProvider({
      ...init,
      fetch: async (input, options) => {
        if (!init.fetch)
          throw new Error('Google Translation requires the desktop transport')
        const body = JSON.parse(String(options?.body)) as Record<
          string,
          unknown
        >
        body.target = request.targetLanguage
        if (request.sourceLanguage && request.sourceLanguage !== 'auto')
          body.source = request.sourceLanguage
        if (request.format) body.format = request.format
        return init.fetch(input, { ...options, body: JSON.stringify(body) })
      },
    }).translate(request)
  },
})
