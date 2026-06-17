---
title: Dead-code scans must include implicit roots
date: 2026-06-16
category: docs/solutions/best-practices
module: dead-code detection
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Building or reviewing repo-wide dead-code detectors
  - Deleting Svelte, TypeScript, or generated support files by reachability graph
  - Auditing Acepe file-level cleanup candidates
tags: [dead-code, reachability, svelte, typescript, tooling]
---

# Dead-code scans must include implicit roots

## Context

During the systematic dead-code sweep, an import graph alone looked sufficient
until verification exposed two false positives: Svelte components loaded from
markup dynamic imports, and an ambient TypeScript declaration file used by the
compiler without any import statement.

## Guidance

Acepe dead-code detectors should model implicit roots and edges before deleting
files. At minimum:

- Treat Svelte markup dynamic imports as edges, not just imports inside
  `<script>` blocks:

  ```svelte
  {#await import("$lib/components/demo.svelte")}
    loading
  {/await}
  ```

- Treat ambient `.d.ts` files as compiler roots even when no module imports them.
- Keep package exports, SvelteKit route conventions, package scripts, Tauri
  config/capabilities, Cargo roots, static assets, and explicit allowlist entries
  as first-class roots.
- Use strict allowlist validation. A malformed classification should fail the
  detector instead of silently producing a bogus candidate class.

## Why This Matters

Dead-code deletion is destructive. If the graph misses an implicit root, the
detector can confidently delete files that builds, demos, or the compiler still
need. The safer pattern is conservative: classify uncertain candidates as live,
test-only, static-root, generated-vendor, or unresolved, then delete only files
that remain strong-dead after verification.

## When to Apply

- Before deleting repo-wide dead-code candidates.
- When adding a new framework convention, runtime loader, generated declaration,
  or dynamically addressed asset path.
- When an apparently dead file is not referenced by static imports but is still
  consumed by build tooling or Svelte markup.

## Examples

The final dead-code detector protects these cases with fixture tests:

```ts
expect(reachable).toContain("packages/site/src/lib/components/demo.svelte");
expect(reachable).toContain("packages/app/src/global.d.ts");
expect(result.isErr()).toBe(true);
```

The first assertion covers Svelte markup dynamic imports, the second covers
ambient declarations, and the third covers malformed allowlist classifications.

## Related

- `docs/plans/2026-06-16-001-refactor-systematic-dead-code-removal-plan.md`
- `docs/reports/dead-code-2026-06-16.md`
