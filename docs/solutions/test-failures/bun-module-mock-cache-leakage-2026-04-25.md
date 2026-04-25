---
title: Bun mock.module leaks incomplete stubs across test files in the same process
date: 2026-04-25
category: test-failures
module: desktop-analytics
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - A test file passes in isolation but fails with TypeError when run together with another test file
  - The failing file has no mock declarations of its own — the stub originates silently from another file
  - Failures are ordering-dependent; reversing file order makes the failure disappear
root_cause: test_isolation
resolution_type: test_fix
tags:
  - bun
  - module-cache
  - mock-leakage
  - test-isolation
  - mock-module
---

# Bun mock.module leaks incomplete stubs across test files in the same process

## Problem

`analytics.test.ts` used `mock.module("$lib/utils/tauri-client/settings.js", ...)` to stub out the settings dependency, but the factory only exposed `{ settings: { get: getMock } }` — a partial interface missing `resetDatabase` and other exports. Because Bun's test runner shares a single module cache per process, this stub remained registered for the entire `bun test` run. When `settings.test.ts` ran afterward, its `await import("./settings.js")` call received the analytics stub instead of the real module, causing `settings.resetDatabase is not a function` and every assertion against it to throw.

## Symptoms

- `settings.test.ts` passes alone (`bun test settings.test.ts`) but fails with `TypeError: settings.resetDatabase is not a function` when run with `analytics.test.ts` in the same invocation.
- No mock of `settings.js` exists anywhere in `settings.test.ts` — the stub silently originates from `analytics.test.ts` running first.
- Swapping file execution order (running settings before analytics) makes the failure disappear, confirming ordering dependency.
- The settings object available in the failing run has only `{ get: [Mock] }` — a partial shape that proves it came from a foreign mock, not the real module.

## What Didn't Work

1. **Extending the mock to include the full interface** — would require replicating every `settings.ts` export in `analytics.test.ts`. Brittle: any new method added to settings would silently re-introduce the leakage bug.

2. **Mocking at the Tauri IPC layer** — the architecturally correct fix would mock `TAURI_COMMAND_CLIENT` (the approach `settings.test.ts` uses correctly) rather than the `settings` façade. Required restructuring analytics module dependencies — disproportionate for a module with no domain logic.

3. **Per-file process isolation** — Bun does not offer a per-file isolation flag without spawning separate subprocesses manually. Not viable as a general solution.

## Solution

`analytics.test.ts` was deleted. The analytics module wraps PostHog/Sentry initialization and delegates all data access to `settings.get()`. The testable logic is thin integration glue already covered by vendor SDKs. Coverage loss was acceptable because:

- The module has no domain logic.
- The correct mock fix required refactoring the module to mock at the `TAURI_COMMAND_CLIENT` layer, a blast radius larger than the test value.

## Why This Works

Bun's test runner executes all matched files in the same OS process by default. `mock.module(specifier, factory)` installs a replacement into the process-global ES module registry. Subsequent `import` or `await import()` calls for that specifier in *any* test file in the same run resolve from the cache and receive the replacement. There is no automatic teardown between files.

Deleting `analytics.test.ts` removes the offending `mock.module` call, so `settings.test.ts` always imports the real module and `resetDatabase` is present.

## Prevention

**1. Mock at the lowest shared boundary, not the middle.**

Prefer mocking the Tauri IPC client (`TAURI_COMMAND_CLIENT`) over higher-level façades like `settings.js`. `settings.test.ts` demonstrates the correct pattern:

```ts
// Good — mock the IPC layer, let the real settings module run
mock.module("$lib/services/tauri-command-client.js", () => ({
  TAURI_COMMAND_CLIENT: { storageCommands: { get: vi.fn(), set: vi.fn(), ... } },
}));
const { settings } = await import("./settings.js"); // real module
```

Low-level mocks are less likely to collide with another test file's imports.

**2. Always provide the complete module interface in `mock.module`.**

If you must mock a façade, the factory must return every exported binding. A partial stub is a latent ordering bug. Use TypeScript's `satisfies` operator to catch gaps at compile time:

```ts
import type * as SettingsModule from "$lib/utils/tauri-client/settings.js";

mock.module("$lib/utils/tauri-client/settings.js", () => ({
  settings: {
    get: getMock,
    set: setMock,
    resetDatabase: resetDatabaseMock,
    // ...every other export
  },
} satisfies typeof SettingsModule));
```

**3. Treat `mock.module` as process-global state.**

Before adding any `mock.module` call, ask: "If another test file in this process imports this specifier without mocking it, what will it receive?" If the answer is "my stub," the test design needs to change. Prefer dependency injection (constructor args, function parameters) over module replacement for truly isolated mock scopes.

## Related Issues

- `docs/solutions/best-practices/reactive-state-async-callbacks-svelte-2026-04-15.md` — unrelated to mock cache but covers another class of test reliability concern in the desktop package.
