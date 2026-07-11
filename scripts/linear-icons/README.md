# Linear Icon Inventory

Phase 1 tooling for extracting Linear's cached SVG icon set without modifying the installed Linear app.

## What it does

1. Reads Chromium Simple Cache entries from `~/Library/Application Support/Linear/Cache/Cache_Data`
2. Decompresses cached `static.linear.app/client/assets/*` bundles (`br`, `gzip`, or identity)
3. Extracts SVG geometry from:
   - dedicated `*Icon.*.js` chunks
   - shared `<symbol id="...">` sprites (for example `Root.*.js`)
   - other reachable JSX bundles that inline `svg` + `path` markup
4. Normalizes view boxes, fills, and strokes to Acepe-friendly `currentColor` SVG
5. Deduplicates identical geometry via SHA-256 geometry hashes
6. Writes a reviewable inventory:

```text
scripts/linear-icons/inventory/
  manifest.json
  svgs/
    close.svg
    filter.svg
    issue-status-backlog.svg
```

## Commands

From repo root:

```bash
bun run linear-icons:extract
```

Optional overrides:

```bash
bun scripts/linear-icons/extract-linear-icons.ts \
  "/path/to/Linear/Cache/Cache_Data" \
  "/path/to/output"
```

## Manifest fields

Each manifest entry records:

- `sourceChunk` — original cached asset basename
- `originalName` — Linear icon name (`CloseIcon`, `IssueStatusBacklog`, ...)
- `cleanName` — kebab-case inventory id (`close`, `issue-status-backlog`)
- `geometryHash` — stable hash of normalized geometry
- `duplicateOf` — canonical icon id when geometry is identical

`inventoryHash` is stable across repeated runs against the same cache contents.

For the website design-system icon sheet:

```bash
bun run linear-icons:sync-website
```

This writes `packages/website/src/lib/design-system/linear-icon-catalog.generated.ts`.

For the shared UI package catalog:

```bash
bun run linear-icons:sync-ui
```

This writes `packages/ui/src/components/icons/linear-icon-catalog.generated.ts`.

Optional overrides:

```bash
bun scripts/linear-icons/generate-website-icon-catalog.ts \
  --inventory /path/to/inventory \
  --output /path/to/linear-icon-catalog.generated.ts
```

## Tests

```bash
bun test scripts/linear-icons/__tests__/linear-icon-inventory.test.ts
```

Fixtures include:

- one dedicated icon cache entry (`CloseIcon`)
- one shared sprite cache entry (`Root`)

## Notes

- This phase only builds the inventory. It does not modify `packages/ui/src/components/icons/svg/`.
- Linear assets may be proprietary. Keep extracted output local until licensing is cleared.
