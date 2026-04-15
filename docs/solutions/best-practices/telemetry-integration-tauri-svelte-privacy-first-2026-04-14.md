---
title: Privacy-first telemetry integration in Tauri + Svelte apps
date: 2026-04-14
category: best-practices
module: analytics
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - Adding PostHog or Sentry to a Tauri desktop app
  - Integrating any telemetry that spans frontend (JS) and backend (Rust) layers
  - Designing analytics opt-out for privacy-sensitive desktop apps
tags:
  - telemetry
  - posthog
  - sentry
  - tauri
  - privacy
  - analytics
  - opt-out
---

# Privacy-first telemetry integration in Tauri + Svelte apps

## Context

PR #112 added PostHog analytics and Sentry crash reporting to Acepe. The initial implementation had 15 review findings across correctness, security, reliability, and standards. The patterns below emerged from fixing those issues and represent durable guidance for telemetry in dual-layer (JS frontend + Rust backend) desktop apps.

## Guidance

### 1. Dual-layer opt-out must be synchronized

Tauri apps have two independent runtimes. A frontend-only analytics toggle leaves Rust-side crash reporting active. Both layers must respect the same preference, ideally via a shared Tauri command the frontend calls on toggle rather than each layer reading the DB independently.

### 2. Use environment variables for provider hosts, not hardcoded URLs

PostHog and Sentry have region-specific endpoints (US vs EU). Hardcoding a host means the wrong region gets used in CI or by contributors in different regions.

```typescript
// ✅ Read from env with a sensible default
function posthogApiHost(): string {
  const envHost = import.meta.env.VITE_POSTHOG_HOST;
  return envHost && envHost.length > 0 ? envHost : "https://eu.i.posthog.com";
}
```

### 3. Sentry beforeSend must check opt-out dynamically

Sentry is initialized once. If `beforeSend` captures the opt-out state at init time, toggling later has no effect.

```typescript
// ❌ Baked at init — toggling has no effect
beforeSend: analyticsEnabled ? undefined : () => null

// ✅ Checked at send time — respects runtime toggle
beforeSend: (event) => (analyticsEnabled ? event : null)
```

### 4. Guard localStorage access for restricted contexts

`localStorage` may throw in SSR, sandboxed iframes, or when storage quota is exceeded. Telemetry code must not crash the app.

```typescript
function readDistinctId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID(); // In-memory fallback
  }
}
```

### 5. Init guards should allow retry on failure

A boolean `initialized` flag that's set before async init completes prevents retry if init fails. Use a promise-based guard that resets to `null` on failure.

```typescript
let initPromise: Promise<void> | null = null;

export async function initAnalytics(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = doInit().catch((err) => {
    initPromise = null; // Allow retry
    throw err;
  });
  return initPromise;
}
```

### 6. Clear device identifiers on opt-out

When a user opts out, delete the persistent device ID from localStorage — don't just stop sending it.

### 7. Wrap captureException in safety guards

Telemetry code that throws inside an error boundary creates infinite recursion. This is the one justified use of try/catch in a neverthrow codebase.

```typescript
export function captureException(error: Error, context?: TelemetryContext): void {
  try {
    if (!analyticsEnabled) return;
    Sentry.captureException(error, { extra: context });
  } catch {
    // Telemetry must never crash the app
  }
}
```

## Why This Matters

Telemetry bugs are invisible in development — they only manifest when real users interact with opt-out flows, restricted environments, or init failures. A single review of PR #112 surfaced 15 issues because telemetry code interacts with privacy, error handling, and dual-runtime synchronization simultaneously. Getting the patterns right once prevents recurring privacy violations and crash-on-crash loops.

## When to Apply

- Adding any analytics or crash reporting SDK to a Tauri app
- Reviewing PRs that touch telemetry initialization or opt-out flows
- Designing privacy controls for desktop apps with JS + Rust layers

## Examples

The full implementation is in `packages/desktop/src/lib/analytics.ts` (frontend) and `packages/desktop/src-tauri/src/analytics.rs` (Rust backend). Test coverage is in `analytics.test.ts` (19 tests) and `analytics-preferences-store.test.ts` (5 tests).

## Related

- PR #112: Add desktop PostHog and Sentry telemetry
- `packages/desktop/src/lib/stores/analytics-preferences-store.svelte.ts` — opt-out persistence
- `packages/desktop/src-tauri/src/lib.rs` — Rust-side Sentry init gated on stored preference
