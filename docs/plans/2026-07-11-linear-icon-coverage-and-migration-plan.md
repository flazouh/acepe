# Linear Icon Coverage and Migration Plan

## Goal

Finish the Linear icon investigation with evidence strong enough to replace Acepe's legacy icon geometry. The generated report must distinguish real extraction gaps from SVGs that are already represented or are not reusable interface icons.

## Current Evidence

- The cache corpus contains 1,136 JSX `svg` constructions.
- The current report labels 937 `extracted` and 199 `needs-review`.
- The reviewed baseline corpus hash is `7a1e536d70955f06ea5e4b499ee9de25bc00ca12b7cf77a9622b564fc8708e4e`. A changed hash requires a documented delta review before regenerated artifacts replace this baseline.
- Every unresolved row currently has the same `missing-semantic-evidence` reason.
- Sampling proves the 199 rows mix different cases:
  - dedicated icon chunks already extracted under semantic names;
  - large illustrations and avatars outside the compact interface-icon scope;
  - dynamic charts, progress indicators, and wrapper SVGs without static reusable geometry;
  - compact icons whose child tag or geometry is dynamic and genuinely needs review.

## Decisions

1. Coverage is candidate classification, not only `FeatureSvg...` name linkage.
2. Each candidate receives one report state:
   - `extracted`: its static geometry is present in the inventory;
   - `excluded`: evidence proves it is outside reusable interface-icon scope or has no self-contained static geometry;
   - `needs-review`: it may be a reusable compact icon but the extractor cannot safely reconstruct it.
3. `complete` means zero `needs-review` rows. Excluded rows remain visible and counted; they are not silently dropped.
   - Exclusion uses a closed reason taxonomy with objective predicates.
   - Every excluded row retains its source span and fingerprint.
   - Negative fixtures prove compact reusable icons cannot be excluded by broad viewBox or wrapper rules.
   - At least one real row from every exclusion reason is audited before `complete` can become true.
4. Geometry and source-span evidence outrank chunk-name or visual-similarity guesses.
5. Runtime semantic mappings remain separately evidence-gated. Extraction coverage never automatically approves an Acepe-to-Linear semantic mapping.
6. The website design-system route remains the review surface. No desktop design-system route is restored.

## Implementation

### 1. Coverage classification

- Extend the coverage row/report types with the `excluded` state and explicit reasons.
- Link dedicated and feature candidates to extracted geometry using candidate-level static geometry, not only generated names.
- Classify clearly non-icon viewBoxes and SVG wrappers without owned geometry as excluded.
- Do not infer exclusion from a missing viewBox: the current extractor's `0 0 16 16` default is valid for some icon components and cannot prove compactness by itself.
- Keep compact candidates with unresolved/dynamic geometry in `needs-review`.

### 2. Extraction support

- Add support one syntax family at a time, starting with static compact shapes whose JSX tag is an identifier bound to a standard SVG shape.
- Do not evaluate arbitrary JavaScript, theme expressions, conditional geometry, or component children.
- Preserve deterministic hashes and provenance.

### 3. Generated artifacts and website

- Run focused tests after each supported syntax family. Regenerate the inventory, UI catalog, and website catalog after a coherent extractor batch and once more for final verification.
- Require every generated artifact in a batch to carry the same corpus hash. Stop and perform a delta review if the installed cache differs from the reviewed baseline.
- Show extracted, excluded, and review counts on the website page.
- Keep the Acepe fallback filter for semantic review.

### 4. Semantic migration

- Trace each remaining Acepe icon through Linear imports, exports, component bindings, and visible control usage.
- Add a failing mapping test before each approved group.
- Approve decorative/brand sprites only when Linear itself uses that exact sprite for the same control.
- Leave unmatched Acepe names on explicit fallback until evidence exists.
- Maintain one exhaustive runtime-resolution manifest keyed by every Acepe icon name. Each entry is an approved Linear mapping, a still-unresolved fallback, or a structured no-equivalent decision with rationale and approval evidence. Expose all three states on the website review surface.

### 5. Final replacement

- Remove legacy Acepe geometry only after every runtime icon has an approved mapping or a structured no-equivalent decision. A no-equivalent decision must also choose a renderable outcome: remove that icon from its call sites or retain explicitly approved Acepe-owned geometry. It must never leave a runtime name without a glyph.
- Run focused extractor and mapping tests, full package checks, and generated-artifact consistency checks.
- Start the Tauri dev app and verify affected surfaces with `bun run qa doctor`, `observe`, `inspect`, and `screenshot`.

## Tests and Verification

- Public seam: `buildFeatureSvgCoverageReport(entries, extractedIcons)`.
- Fixture: a dedicated icon candidate is reported as extracted even though its inventory name is semantic rather than `FeatureSvg...`.
- Fixture: a large illustration is reported as excluded with an explicit reason.
- Fixture: a dynamic compact SVG remains needs-review.
- Existing deterministic manifest and normalized geometry tests remain green.
- Generated coverage totals equal extracted + excluded + needs-review.
- Website SSR exposes the same totals as the generated catalog.
- Runtime mappings pass provenance/hash checks.
- Diagnose the existing Rust build blocker without overwriting unrelated user changes. Fix it only when the correction is isolated and safe; otherwise preserve the changes and report the exact blocking owner/path. Desktop visual verification remains required before the migration goal is complete.

## Constraints

- Never approve a mapping from name similarity or screenshot similarity alone.
- Never execute cached Linear JavaScript.
- Preserve unrelated dirty worktree changes.
- Do not claim full migration while any runtime fallback lacks evidence or an explicit no-equivalent decision.
