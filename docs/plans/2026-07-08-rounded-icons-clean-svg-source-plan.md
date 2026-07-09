# Rounded Icons Clean SVG Source Plan

## Goal

Make Acepe rounded icons clean to read, copy, and reuse by moving the human source of truth to clean-named SVG files.

Current shape:

```text
generated source id -> SVG data -> RoundedIcon
folder-bpwd3kcz     -> paths    -> name="folder"
```

Target shape:

```text
clean SVG file      -> generated data -> RoundedIcon
icons/svg/folder.svg -> paths         -> name="folder"
```

## Scope

- Add clean SVG files under `packages/ui/src/components/icons/svg/`.
- Keep one SVG file per primary clean icon name.
- Keep generated TypeScript as an internal artifact for fast inline rendering.
- Keep the existing Svelte API working:

```svelte
<RoundedIcon name="folder" />
```

- Keep aliases that point to the same glyph, such as `browser` and `globe`, as metadata aliases instead of duplicated SVG files.
- Do not add Phosphor or another icon dependency.
- Do not require downstream projects to understand hashed source ids.

## Non-Goals

- Do not rewrite all existing hand-authored Svelte icons.
- Do not change product call sites outside existing Phosphor cleanup.
- Do not load SVGs at runtime through fetch or dynamic imports.
- Do not invent names for ambiguous icons. Keep only curated clean names.

## Files

- `packages/ui/src/components/icons/svg/*.svg`
- `packages/ui/scripts/generate-rounded-icons.mjs`
- `packages/ui/src/components/icons/rounded-icon-data.generated.ts`
- `packages/ui/src/components/icons/rounded-icon-library.ts`
- `packages/ui/src/components/icons/rounded-icon.svelte`
- `packages/ui/src/components/icons/index.ts`
- `packages/ui/src/components/icons/__tests__/rounded-icon-data.test.ts`
- `packages/ui/src/components/icons/README.md`

## Implementation

1. Generate clean SVG files from the current rounded icon data.
   - Group `roundedIconLibrary` entries by their current `sourceName`.
   - Choose one primary clean name per group.
   - Prefer a curated primary name when a glyph has several aliases, for example `globe` over `browser`.
   - Write one SVG file for each primary clean name.
   - Use the existing `viewBox` and `inner` data.
   - Preserve `currentColor` behavior.

2. Update the generator to read from the local clean SVG folder by default.
   - The generator should parse `packages/ui/src/components/icons/svg/*.svg`.
   - It should emit `rounded-icon-data.generated.ts`.
   - `roundedIconNames` should become the clean names.
   - `roundedIconSourceNames` should be a backwards-compatible alias to `roundedIconNames`.
   - `RoundedIconCanonicalName` stays as a deprecated compatibility type only.

3. Keep alias metadata for alternate names.
   - `roundedIconAliases` maps alternate clean names to primary clean names.
   - `resolveRoundedIconName("browser")` can return `"globe"` if both names share the same SVG.
   - Product code can still pass any `RoundedIconName`.

4. Update docs.
   - Describe `svg/` as the human source of truth.
   - Explain that generated data is internal.
   - Give React/Svelte adapter guidance without requiring either framework.

## Tests

- Update rounded icon tests to prove:
  - all public names resolve to existing icon data
  - every SVG file is clean-named and parseable
  - selected semantic aliases still resolve to the expected primary clean name
  - `RoundedIcon` data keeps expected `viewBox` values for important icons

## Verification

- `cd packages/ui && bun test src/components/icons/__tests__/rounded-icon-data.test.ts`
- `cd packages/ui && bunx tsc --ignoreConfig --noEmit --moduleResolution bundler --module ESNext --target ESNext --strict --skipLibCheck src/components/icons/rounded-icon-library.ts src/components/icons/rounded-icon-data.generated.ts src/components/icons/index.ts`
- `cd packages/desktop && bun run check`
- `cd packages/ui && bun run check`

`packages/ui && bun run check` may still report existing unrelated errors. If so, report them separately from the icon verification.

## Risks

- Generating hundreds of SVG files can make the diff large.
- If aliases are inverted incorrectly, an icon name could render the wrong glyph.
- If SVG parsing drops attributes, icons could lose stroke/fill behavior.
- If generated data is removed entirely, current inline rendering may become harder to bundle consistently.

## Review Notes

- Prefer committing clean SVG files and generated TypeScript together for now, because `@acepe/ui` does not currently have a guaranteed prebuild step for consumers.
- The generated file remains acceptable only as a machine artifact. The readable source is `svg/*.svg`.
