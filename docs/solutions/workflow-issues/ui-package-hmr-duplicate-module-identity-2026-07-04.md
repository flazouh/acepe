---
title: "@acepe/ui HMR requires canonical module identity"
date: 2026-07-04
last_updated: 2026-07-04
category: docs/solutions/workflow-issues
module: desktop dev workflow
problem_type: workflow_issue
component: vite_hmr
severity: high
applies_when:
  - Editing packages/ui during Tauri/Vite dev
  - @acepe/ui changes recompile on the server but the WebView DOM stays stale
  - HMR websocket shows duplicate update paths for the same Svelte file
tags: [hmr, vite, acepe-ui, monorepo, workflow, tauri]
---

# @acepe/ui HMR requires canonical module identity

## Problem

Editing `packages/ui/src/**/*.svelte` during desktop dev could recompile correctly on the Vite server while the Tauri WebView kept stale DOM (old classes, layout, attributes) until a full reload.

Investigation showed the same source file in the module graph under two URLs:

- `/@fs/.../packages/ui/src/.../component.svelte`
- `/node_modules/@acepe/ui/src/.../component.svelte`

Vite broadcast HMR `update` payloads for both paths. The client could bind `import.meta.hot` to one URL while patches arrived on both (or the wrong one), so in-place component updates did not apply reliably.

`resolve.preserveSymlinks: false` alone was not enough to dedupe these graph entries when desktop imports flowed through `@acepe/ui` while internal resolution still surfaced the symlinked `node_modules` URL.

## Fix

Add export-driven Vite `resolve.alias` entries so every public `@acepe/ui` import resolves to a single real file under `packages/ui/`:

1. **`buildAcepeUiResolveAliases()`** reads `packages/ui/package.json` `exports` and maps each key (`"."`, `"./usage-widget"`, etc.) to an absolute path. Aliases are sorted longest-key-first so subpaths win over the root entry.
2. **Symlink root alias:** also map `packages/desktop/node_modules/@acepe/ui` → `packages/ui` so graph IDs cannot split across `@fs` and `node_modules`.
3. Wire aliases in `packages/desktop/vite.config.js` alongside existing dev pieces (`acepeUiPackageDev()` watcher, `optimizeDeps.exclude`, `ssr.noExternal`, `fs.allow`).

Restart the dev server after changing `vite.config.js` — aliases apply at startup.

## Verification

```bash
cd packages/desktop
bun test ./scripts/vite-acepe-ui-aliases.test.ts
bun run qa hmr-ui-probe   # expects one canonical @fs svelte path, no node_modules duplicate
```

Optional visual check when the usage widget is mounted:

```bash
bun run qa inspect --selector='[data-usage-vertical-meter]'
bun run qa screenshot
```

## Notes

- Do not mass-change desktop imports to subpaths; aliases cover barrel and subpath entry points.
- Do not add HMR dedupe/`handleHotUpdate` plugins unless aliasing fails — fix identity before the graph is built.
- New `@acepe/ui` exports picked up automatically from `package.json` on dev server restart.
