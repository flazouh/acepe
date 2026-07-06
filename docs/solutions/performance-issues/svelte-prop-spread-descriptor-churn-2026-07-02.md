---
title: Svelte prop spread descriptor churn in hot message render paths
date: 2026-07-02
category: performance-issues
module: agent-panel-content-block-rendering
problem_type: performance_issue
component: assistant
symptoms:
  - The Rust process stayed mostly idle while WebKit WebContent used about one full CPU core.
  - A WebContent sample was hot in DOMTimer, microtasks, ProxyObject, and getOwnPropertyDescriptor.
  - Repeated timer-style updates could make nested Svelte rest/spread props expensive to flatten.
root_cause: async_timing
resolution_type: code_fix
severity: high
tags: [agent-panel, svelte, webkit, proxy, content-blocks, performance]
---

# Svelte prop spread descriptor churn in hot message render paths

## Problem
Acepe could look busy or frozen while the native Rust process was idle. The hot work was inside the WebKit WebContent process, not the backend.

## Symptoms
- `target/debug/acepe` stayed low CPU.
- `com.apple.WebKit.WebContent` stayed near one full CPU core.
- Sampling showed `DOMTimer::fired`, microtask checkpoints, `ProxyObject`, and `objectConstructorGetOwnPropertyDescriptor`.
- A focused Vitest reproduction showed repeated flattening of nested Svelte rest/spread props can create thousands of descriptor traps.

## What Didn't Work
- Looking first at Rust startup code did not match the sample, because the hot process was WebContent.
- Focusing on lazy scene-array slicing did not match the descriptor-shaped stack. The reproduction showed slicing caused `get` and `has` traps, but not `getOwnPropertyDescriptor` traps.
- Keeping the dynamic content-block renderer and only tuning timers would leave the expensive prop flattening boundary in place.

## Solution
Remove dynamic component rendering with spread props from the hot content-block path.

Before:

```svelte
{@const Component = routeState.renderer.component}
<Component {...routeState.props} {isStreaming} {tokenRevealCss} />
```

After:

```svelte
{#if renderBlock.type === "text"}
  <TextBlock text={renderBlock.text} {isStreaming} {tokenRevealCss} />
{:else if renderBlock.type === "image"}
  <ImageBlock data={renderBlock.data} mimeType={renderBlock.mimeType} uri={renderBlock.uri} />
{/if}
```

The router state now returns explicit render data for each ACP block type instead of a generic component plus prop bag.

## Why This Works
Svelte rest/spread props are convenient, but they can be backed by proxies. In a timer-driven render path, repeatedly flattening those props asks JavaScriptCore for property descriptors over and over:

```text
timer tick
  -> Svelte update
  -> flatten spread/rest props
  -> Object.getOwnPropertyDescriptor(proxy, key)
  -> WebKit CPU hotspot
```

Direct props keep the hot path boring:

```text
timer tick
  -> Svelte update
  -> explicit prop reads
  -> no generic prop-bag enumeration
```

## Prevention
- Avoid dynamic `<Component {...props}>` in streaming, timer-driven, or frequently re-rendered message paths.
- Prefer explicit discriminated render data when a component has a small known set of variants.
- For WebContent CPU spikes, sample WebContent and create a small proxy-trap reproduction before changing Rust code.

## Related Issues
- `packages/desktop/src/lib/acp/components/messages/content-block-router.svelte`
- `packages/desktop/src/lib/acp/components/messages/content-block-router-state.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/proxy-trap-audit.test.ts`
- `docs/solutions/performance-issues/cursor-session-start-freeze-proxy-array-chain-2026-07-02.md`
