# Testing Patterns

## Overview

The project has two test layers:

| Layer | Runner | Files | Command |
|---|---|---|---|
| Unit / logic | bun test | `*.test.ts` | `bun test` |
| Component / DOM | vitest + happy-dom | `*.vitest.ts` | `bun run test:vitest` |
| Rust | cargo test | inline `#[cfg(test)]` | `cargo test --lib` |

The `test` script in `packages/desktop/package.json` runs both bun and vitest files together:

```bash
AGENT=1 bun test $(find src -type f \( -name '*.test.ts' -o -name '*.vitest.ts' \))
```

Total: 1482+ tests across 113 files, runs in ~7.5s.

---

## Test File Conventions

### Naming and Location

- Unit/logic tests: `*.test.ts` — co-located next to source or in a `__tests__/` subdirectory
- Component/DOM tests: `*.svelte.vitest.ts` or `*.vitest.ts` — always in `__tests__/` or alongside source
- Rust tests: inline `#[cfg(test)] mod tests { ... }` blocks in the source file, or in a separate `*_test.rs` / `test_integration.rs` file

Examples:

- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/create-auto-scroll.test.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/effective-project-path.vitest.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-header.project-style.svelte.vitest.ts`
- `packages/desktop/src-tauri/src/db/repository_test.rs`
- `packages/desktop/src-tauri/src/cursor_history/test_integration.rs`

### Choosing bun test vs vitest

- **Use `bun test`** (`*.test.ts`) for all pure logic, state classes, state machines, and functions that do not need a DOM.
- **Use vitest** (`*.vitest.ts`) for anything that needs DOM rendering: Svelte component tests, browser APIs, or Svelte rune reactivity.
- Both import styles (`bun:test` and `vitest`) coexist in the codebase; pick based on whether a DOM is needed.

---

## bun:test Patterns

### Imports

```typescript
import { beforeEach, describe, expect, it, mock } from "bun:test";
```

### Structure

Tests use `describe` / `it` with nested `describe` blocks for grouping by method or scenario:

```typescript
describe("AutoScrollLogic", () => {
  describe("initial state", () => {
    it("starts following", () => { ... });
  });

  describe("isNearBottom", () => {
    it("returns true when within threshold (10px)", () => { ... });
    it("returns false when outside threshold", () => { ... });
  });
});
```

See `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/create-auto-scroll.test.ts`
for a comprehensive example of this structure applied across many scenarios.

### Mocking with `mock()`

Use `mock()` from `bun:test` to create spy functions:

```typescript
const removeWorktree = mock(() => okAsync(undefined));
const markSessionWorktreeDeleted = mock(() => undefined);

expect(removeWorktree).toHaveBeenCalledWith("/repo/.worktrees/feature-a", true);
expect(markSessionWorktreeDeleted).not.toHaveBeenCalled();
```

Module mocking uses `mock.module()`:

```typescript
mock.module("@sentry/svelte", () => ({
  init: mock(() => {}),
  captureException: mock(() => {}),
}));

mock.module("./utils/tauri-commands.js", () => ({
  invoke: mock(() => Promise.resolve("distinct-id")),
}));
```

For modules with singleton state that must be reset between tests, append a version query
string to force fresh imports:

```typescript
let version = 0;
beforeEach(async () => {
  version += 1;
  const module = await import(`./analytics.js?test=${version}`);
  initAnalytics = module.initAnalytics;
});
```

See `packages/desktop/src/lib/analytics.test.ts` for this pattern in full.

### Testing neverthrow Results

Check result types explicitly, then access `.value` inside the guard:

```typescript
const result = await doSomething();
expect(result.isOk()).toBe(true);
if (result.isOk()) {
  expect(result.value.content).toBe("expected");
}

const failure = await doSomethingBad();
expect(failure.isErr()).toBe(true);
```

Pass `okAsync` / `errAsync` from neverthrow as mock return values:

```typescript
import { errAsync, okAsync } from "neverthrow";

const removeWorktree = mock(() => okAsync(undefined));
const failingOp = mock(() => errAsync(new Error("remove failed")));
```

---

## vitest Patterns

### Imports

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
```

### DOM Environment

vitest tests run under `happy-dom` (configured in `packages/desktop/vite.config.js`):

```javascript
test: {
  globals: true,
  environment: "happy-dom",
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
}
```

### Svelte Component Tests

Use `@testing-library/svelte` for rendering and interaction:

```typescript
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import MyComponent from "../my-component.svelte";

// Required shim for Svelte's internal module resolution in vitest
vi.mock(
  "svelte",
  async () => import("../../../../../node_modules/svelte/src/index-client.js")
);

afterEach(() => { cleanup(); });

describe("MyComponent", () => {
  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(MyComponent, { onClose });

    const button = container.querySelector("button[title='Close']");
    if (button) await fireEvent.click(button);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

The `vi.mock("svelte", ...)` shim is required in every Svelte component vitest file.
See `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-header.project-style.svelte.vitest.ts`.

All props must be passed explicitly — no spread syntax. Pass every required prop by name.

### Module Mocking with `vi.mock()`

```typescript
vi.mock("../acp-event-bridge.js", () => ({
  openAcpEventSource: vi.fn(),
}));

vi.mock("../../store/api.js", () => ({
  api: {
    respondInboundRequest: vi.fn(() => okAsync(undefined)),
  },
}));
```

Use `vi.clearAllMocks()` in `beforeEach` to reset state between tests.

### XState Machine Tests

Use `createActor` from xstate to drive state machines synchronously:

```typescript
import { createActor } from "xstate";
import { sessionMachine } from "../session-machine";

it("should complete content loading", () => {
  const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
  actor.start();

  actor.send({ type: "LOAD" });
  actor.send({ type: "LOADED" });

  const state = actor.getSnapshot().value;
  expect(state.content).toBe("loaded");
});
```

See `packages/desktop/src/lib/acp/logic/__tests__/session-machine.test.ts`.

---

## Dependency Injection for Testability

Pure logic functions accept dependencies as parameters rather than importing them directly.
This makes them trivially testable without module mocking.

```typescript
// Source
export function removeWorktreeAndMarkSessionWorktreeDeleted(
  options: RemoveOptions,
  deps: {
    removeWorktree: (path: string, force: boolean) => ResultAsync<void, Error>;
    markSessionWorktreeDeleted: (id: string) => void;
    clearSessionWorktreeDeleted: (id: string) => void;
    disconnectSession: (id: string) => void;
  }
): ResultAsync<void, Error> { ... }

// Test — packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/worktree-removal.test.ts
it("marks the session worktree as deleted after successful removal", async () => {
  const removeWorktree = mock(() => okAsync(undefined));
  const markSessionWorktreeDeleted = mock(() => undefined);

  const result = await removeWorktreeAndMarkSessionWorktreeDeleted(
    { force: true, sessionId: "session-123", worktreePath: "/repo/.worktrees/feature-a" },
    {
      removeWorktree,
      markSessionWorktreeDeleted,
      clearSessionWorktreeDeleted: mock(() => undefined),
      disconnectSession: mock(() => undefined),
    }
  );

  expect(result.isOk()).toBe(true);
  expect(markSessionWorktreeDeleted).toHaveBeenCalledWith("session-123");
});
```

---

## Test Factories

Shared factory functions for test data are extracted to `*-factories.ts` files co-located
in the `__tests__/` directory. They are not test files themselves (no `describe`/`it`).

Example: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/session-entry-factories.ts`

```typescript
export function createUserEntry(id: string): SessionEntry {
  return {
    id,
    type: "user",
    message: {
      content: { type: "text", text: `User message ${id}` },
      chunks: [{ type: "text", text: `User message ${id}` }],
      sentAt: new Date(),
    },
    timestamp: new Date(),
  };
}

export function createAssistantEntry(id: string): SessionEntry { ... }
export function createToolCallEntry(id: string): SessionEntry { ... }
```

Factories are imported into multiple test files:

```typescript
import {
  createAssistantEntry,
  createToolCallEntry,
  createUserEntry,
} from "./session-entry-factories.js";
```

For inline mock objects, use `as unknown as MyType` to satisfy TypeScript when providing
only the subset of fields the unit under test actually needs:

```typescript
const mockStore = {
  activeAgentId: "claude-code",
} as unknown as SessionStore;
```

---

## Class-Based State Testing

State classes (`.svelte.ts`) are instantiated directly in tests. The `$state` and `$derived`
runes work in the bun/vitest test environment without a real DOM:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { StickyHeaderLogic } from "../sticky-header-state.svelte.js";
import { createUserEntry, createAssistantEntry } from "./session-entry-factories.js";

describe("StickyHeaderLogic", () => {
  let state: StickyHeaderLogic;

  beforeEach(() => {
    state = new StickyHeaderLogic();
  });

  it("has null sticky user message initially", () => {
    expect(state.stickyUserMessage).toBeNull();
  });

  it("builds segments when entries are provided", () => {
    state.updateEntries([createUserEntry("u1"), createAssistantEntry("a1")]);
    state.onScroll(1, new Set([1]));
    expect(state.stickyUserMessage?.id).toBe("u1");
  });
});
```

See `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/sticky-header-state.test.ts`.

---

## Parameterized Tests

Use `it.each()` for data-driven test cases:

```typescript
const ALL_PHASES: VoiceInputPhase[] = ["idle", "recording", "transcribing", "complete", "error"];

it.each(
  ALL_PHASES.filter((p) => p !== "recording" && p !== "transcribing")
)("returns false for %s", (phase) => {
  expect(canCancelVoiceInteraction(phase)).toBe(false);
});
```

See `packages/desktop/src/lib/acp/components/agent-input/logic/__tests__/voice-ui-state.test.ts`.

---

## Global State / Singleton Testing

When testing modules with internal caches or singleton state, expose a
`clearXxxForTests()` reset function from the source module and call it in `beforeEach`:

```typescript
// Source exports:
export function clearProjectSelectionMetadataCacheForTests(): void { ... }

// Test:
beforeEach(() => {
  clearProjectSelectionMetadataCacheForTests();
});
```

See `packages/desktop/src/lib/acp/components/__tests__/project-selection-metadata-cache.vitest.ts`.

---

## DOM / Browser API Mocking

When testing code that uses `requestAnimationFrame`, `localStorage`, or other browser APIs,
install synchronous shims in `beforeEach` and restore in `afterEach`:

```typescript
// From packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/thread-follow-controller.test.ts
const originalRAF = globalThis.requestAnimationFrame;

beforeEach(() => {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(performance.now());
    return 1;
  };
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRAF;
});
```

For `localStorage`, assign a `Map`-backed object to `globalThis`:

```typescript
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  },
});
```

See `packages/desktop/src/lib/analytics.test.ts`.

---

## Rust Tests

### Unit Tests (inline)

Test modules live at the bottom of source files:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_upsert_inserts_new_record() {
        let db = setup_test_db().await;
        let result = SessionMetadataRepository::upsert(&db, "session-123".to_string(), ...).await;
        assert!(result.is_ok());
    }
}
```

### Database Tests

Use in-memory SQLite with migrations applied via a shared helper:

```rust
async fn setup_test_db() -> DbConn {
    let db = Database::connect("sqlite::memory:")
        .await
        .expect("Failed to connect to in-memory SQLite");
    crate::db::migrations::Migrator::up(&db, None)
        .await
        .expect("Failed to run migrations");
    db
}
```

See `packages/desktop/src-tauri/src/db/repository_test.rs`.

### Filesystem Tests

Use the `tempfile` crate for isolated temporary directories:

```rust
use tempfile::TempDir;

#[test]
fn test_scan_project() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("file1.ts"), "const x = 1;\n").unwrap();
    let files = scan_project(dir.path()).unwrap();
    assert_eq!(files.len(), 1);
}
```

See `packages/desktop/src-tauri/src/file_index/scanner.rs`.

### Integration / Live Tests

Tests requiring external processes (Cursor, Claude) are guarded by an environment variable:

```rust
fn live_cursor_tests_enabled() -> bool {
    std::env::var("ACEPE_RUN_LIVE_CURSOR_TESTS")
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}
```

See `packages/desktop/src-tauri/src/cursor_history/test_integration.rs`.

### Running Rust Tests

```bash
# Preferred during development — scoped to one module
cargo test --lib acp::parsers::adapters
cargo test --lib db::repository

# Full suite — before commit only (~2 min)
cargo test --lib

# Skip expensive/live tests
cargo test -- --skip claude_history::export_types
```

---

## Biome Overrides for Test Files

`packages/desktop/biome.json` relaxes certain rules in test files
(`**/*.test.ts`, `**/*.vitest.ts`, `**/__tests__/**`):

| Rule | Production | Tests |
|---|---|---|
| `noUnusedVariables` | error | off |
| `noExplicitAny` | error | off |
| `noAssignInExpressions` | error | off |
| `noCommonJs` | error | off |

This allows test helpers to use `any` for partial mock types without lint errors.
