# Claude Code model catalog fixtures

These fixtures are pinned excerpts extracted from real Claude Code binaries.
They exist so catalog-extraction tests are deterministic and do not depend on
a Claude install being present on CI.

Each file contains the raw `firstParty:"claude-...",bedrock:"...",vertex:"...",foundry:"..."`
substrings recovered from the installed Claude binary for that version, one
per line. Keep the files verbatim — the tests assert behavior on the real
output shape that Bun/esbuild produces, including duplicate occurrences that
appear because the compiled JS references each config from multiple call sites.

## How these were regenerated

```bash
for v in 2.1.118 2.1.119; do
  binary="$HOME/.local/share/claude/versions/$v"
  strings -a "$binary" \
    | grep -oE 'firstParty:"claude-[A-Za-z0-9-]+"[^}]*' \
    > packages/desktop/src-tauri/src/acp/providers/fixtures/claude_catalog/claude-${v//./_}-configs.txt
done
```

## Expected content (2.1.119)

12 distinct canonical model IDs expressed across 24 config-line occurrences:

- claude-3-5-haiku-20241022
- claude-3-5-sonnet-20241022
- claude-3-7-sonnet-20250219
- claude-haiku-4-5-20251001
- claude-sonnet-4-20250514
- claude-sonnet-4-5-20250929
- claude-sonnet-4-6
- claude-opus-4-20250514
- claude-opus-4-1-20250805
- claude-opus-4-5-20251101
- claude-opus-4-6
- claude-opus-4-7
