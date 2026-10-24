# Offline translation language catalogs

- `qwen35.json`: the 201 languages and dialects in the **Multilingual Support** table of the [official Qwen3.5 release post](https://qwen.ai/blog?id=qwen3.5), published February 15, 2026. Names are mapped to BCP 47 language tags, preferring two-letter codes where available and retaining specific dialect codes (for example `ars` for Najdi Arabic, `mhr` for Meadow Mari, and `azj` for North Azerbaijani). Simplified and traditional Chinese use `zh-Hans` and `zh-Hant`. This is the default selection catalog for all LLM connections, not a guarantee of every model's translation quality.
- `deepl.json`: DeepL's official translation table. Variant entries are target-only; base entries are available as source and target languages.
- `google.json`: the NMT table from Google Cloud Translation documentation, matching the NMT model used by the client. Accepted legacy aliases are canonicalized and deduplicated.
- `sources.json`: source URLs and the snapshot retrieval date.

Application code imports these snapshots without network access. Language names are displayed through browser internationalization data where available; published names identify languages absent from that data and preserve dialect distinctions that the internationalization runtime would otherwise merge. `translation-languages.ts` adds existing regional preferences and provider variants of languages already in Qwen's list. It does not merge machine providers' base languages into the LLM list. There is no manual language entry.

The Qwen list is maintained explicitly: review changes against the named model's published table, verify dialect-to-code mappings against the IANA BCP 47 registry, and run the catalog tests. The full IANA catalog is not shipped with the application.

Refresh the machine translation snapshots from the repository root:

```sh
pnpm exec node scripts/update-translation-languages.mjs
pnpm exec prettier --write apps/desktop-ui/src/lib/translation/languages/*.json
```

For an offline refresh, pass downloaded DeepL `language-table.jsx` and Google language documentation files as the two positional arguments. The script preserves the curated Qwen list. Review source/target changes and run the translation language tests after refreshing.
