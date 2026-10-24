# Offline translation language catalogs

- `iana.json`: current two- and three-letter language subtags from the IANA BCP 47 registry. Deprecated entries, collections, private-use ranges and non-language sentinel values (`und`, `mul`, `zxx`, `mis`) are excluded. This includes historical and constructed languages; it is a selection catalog, not a claim about LLM translation quality.
- `deepl.json`: DeepL's official translation table. Variant entries are target-only; base entries are available as source and target languages.
- `google.json`: the NMT table from Google Cloud Translation documentation, matching the NMT model used by the client. Accepted legacy aliases are canonicalized and deduplicated.
- `sources.json`: source URLs, retrieval date and IANA registry date.

Application code imports these snapshots without network access. Language names are displayed through bundled browser internationalization data where available; the registry's proper names identify languages absent from that data. Existing regional preferences and provider variants are added to the LLM catalog by `translation-languages.ts`.

Refresh from the repository root:

```sh
pnpm exec node scripts/update-translation-languages.mjs
pnpm exec prettier --write apps/desktop-ui/src/lib/translation/languages/*.json
```

For an offline refresh, pass downloaded IANA registry, DeepL `language-table.jsx` and Google language documentation files as the three positional arguments. Review source/target changes and run the translation language tests after refreshing.
