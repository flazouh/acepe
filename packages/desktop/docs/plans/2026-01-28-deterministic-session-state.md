# Deterministic Session State Management

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the dual-state bug by making XState machine the single source of truth for session state.

**Architecture:** Remove `connectionState` from hotState. Derive all UI state from the XState machine. Use discriminated unions for type-safe state transitions. Reduce layers from 6 to 3.

**Tech Stack:** XState 5, Svelte 5 runes ($derived), TypeScript discriminated unions, neverthrow

---

## Overview

### The Problem

```typescript
// Current: TWO places storing connectionState
hotStateManager.updateHotState({ connectionState: READY }); // Can forget this!
connectionManager.initializeConnectedSession(); // XState machine

// Result: They can get out of sync, causing bugs like missing input field
```

### The Solution

```typescript
// New: ONE place storing state
machine.send({ type: "SESSION_CREATED", modes, models });

// UI derives from machine (always correct)
const connectionState = $derived(machine.getSnapshot().context.connection);
const inputEnabled = $derived(connectionState === ConnectionState.READY);
```

### Files Changed

| Phase | Files                                 | Type   |
| ----- | ------------------------------------- | ------ |
| 1     | `session-machine.ts`                  | Modify |
| 1     | `session-machine.test.ts`             | Modify |
| 2     | `session-state-store.svelte.ts` (NEW) | Create |
| 2     | `session-state-store.test.ts` (NEW)   | Create |
| 3     | `session-connection-manager.ts`       | Modify |
| 3     | `session-store.svelte.ts`             | Modify |
| 4     | `types.ts`                            | Modify |
| 4     | `session-hot-state-store.svelte.ts`   | Modify |
| 5     | Integration tests                     | Create |

---

## Phase 1: Enhance the State Machine

### Task 1.1: Add Context to State Machine

The machine needs to store modes, models, and error info - not just track states.

**Files:**

- Modify: `src/lib/acp/logic/session-machine.ts`
- Modify: `src/lib/acp/logic/__tests__/session-machine.test.ts`

**Step 1: Write the failing test**

```typescript
// In session-machine.test.ts, add new describe block:

describe("Machine Context", () => {
	it("should store modes and models on SESSION_CREATED", () => {
		const actor = createActor(sessionMachine, {
			input: { sessionId: "test" },
		});
		actor.start();

		const modes = [{ id: "plan", name: "Plan" }];
		const models = [{ id: "opus", name: "Opus" }];

		actor.send({
			type: "SESSION_CREATED",
			modes,
			models,
			currentModeId: "plan",
			currentModelId: "opus",
		});

		const context = actor.getSnapshot().context;
		expect(context.modes).toEqual(modes);
		expect(context.models).toEqual(models);
		expect(context.currentModeId).toBe("plan");
		expect(context.currentModelId).toBe("opus");
	});

	it("should store error message on connection error", () => {
		const actor = createActor(sessionMachine, {
			input: { sessionId: "test" },
		});
		actor.start();

		actor.send({ type: ConnectionEvent.CONNECT });
		actor.send({
			type: ConnectionEvent.ERROR,
			error: "Connection refused",
		});

		const context = actor.getSnapshot().context;
		expect(context.connectionError).toBe("Connection refused");
	});

	it("should clear error on successful retry", () => {
		const actor = createActor(sessionMachine, {
			input: { sessionId: "test" },
		});
		actor.start();

		// Get to error state
		actor.send({ type: ConnectionEvent.CONNECT });
		actor.send({ type: ConnectionEvent.ERROR, error: "Failed" });
		expect(actor.getSnapshot().context.connectionError).toBe("Failed");

		// Retry and succeed
		actor.send({ type: ConnectionEvent.RETRY });
		actor.send({ type: ConnectionEvent.SUCCESS });

		expect(actor.getSnapshot().context.connectionError).toBeNull();
	});
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/desktop && bun test session-machine --test-name-pattern="Machine Context"
```

Expected: FAIL - `SESSION_CREATED` event doesn't exist, context doesn't have modes/models

**Step 3: Add context types and machine updates**

```typescript
// In session-machine.ts, update the types:

export interface SessionMachineContext {
	sessionId: string;
	// Capabilities
	modes: Mode[];
	models: Model[];
	currentModeId: string | null;
	currentModelId: string | null;
	// Error state
	connectionError: string | null;
	contentError: string | null;
}

// Add new events:
export const SessionEvent = {
	...ConnectionEvent,
	...ContentEvent,
	SESSION_CREATED: "SESSION_CREATED",
} as const;

export type SessionCreatedEvent = {
	type: typeof SessionEvent.SESSION_CREATED;
	modes: Mode[];
	models: Model[];
	currentModeId: string | null;
	currentModelId: string | null;
};

export type ConnectionErrorEvent = {
	type: typeof ConnectionEvent.ERROR;
	error: string;
};

// Update the machine definition:
export const sessionMachine = setup({
	types: {
		context: {} as SessionMachineContext,
		events: {} as SessionMachineEvents,
		input: {} as { sessionId: string },
	},
	actions: {
		storeSessionData: assign({
			modes: ({ event }) => (event as SessionCreatedEvent).modes,
			models: ({ event }) => (event as SessionCreatedEvent).models,
			currentModeId: ({ event }) => (event as SessionCreatedEvent).currentModeId,
			currentModelId: ({ event }) => (event as SessionCreatedEvent).currentModelId,
		}),
		storeConnectionError: assign({
			connectionError: ({ event }) => (event as ConnectionErrorEvent).error,
		}),
		clearConnectionError: assign({
			connectionError: () => null,
		}),
	},
}).createMachine({
	id: "session",
	context: ({ input }) => ({
		sessionId: input.sessionId,
		modes: [],
		models: [],
		currentModeId: null,
		currentModelId: null,
		connectionError: null,
		contentError: null,
	}),
	// ... rest of machine with actions assigned to transitions
});
```

**Step 4: Run test to verify it passes**

```bash
cd packages/desktop && bun test session-machine --test-name-pattern="Machine Context"
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/acp/logic/session-machine.ts src/lib/acp/logic/__tests__/session-machine.test.ts
git commit -m "feat(session-machine): add context for modes, models, errors

The machine now stores session capabilities and error state,
preparing for single-source-of-truth architecture.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 1.2: Add SESSION_CREATED Transition

**Files:**

- Modify: `src/lib/acp/logic/session-machine.ts`
- Modify: `src/lib/acp/logic/__tests__/session-machine.test.ts`

**Step 1: Write the failing test**

```typescript
describe("SESSION_CREATED Event", () => {
	it("should transition from DISCONNECTED to READY on SESSION_CREATED", () => {
		const actor = createActor(sessionMachine, {
			input: { sessionId: "new-session" },
		});
		actor.start();

		// Initial state
		expect(actor.getSnapshot().value.connection).toBe(ConnectionState.DISCONNECTED);

		// Create session
		actor.send({
			type: "SESSION_CREATED",
			modes: [{ id: "build", name: "Build" }],
			models: [{ id: "sonnet", name: "Sonnet" }],
			currentModeId: "build",
			currentModelId: "sonnet",
		});

		// Should be READY immediately (new sessions don't need warmup)
		const state = actor.getSnapshot();
		expect(state.value.connection).toBe(ConnectionState.READY);
		expect(state.value.content).toBe(ContentState.LOADED); // New session = empty but loaded
		expect(state.context.modes).toHaveLength(1);
	});

	it("should derive correct UI state after SESSION_CREATED", () => {
		const actor = createActor(sessionMachine, {
			input: { sessionId: "new-session" },
		});
		actor.start();

		actor.send({
			type: "SESSION_CREATED",
			modes: [],
			models: [],
			currentModeId: null,
			currentModelId: null,
		});

		const uiState = deriveSessionUIState(actor.getSnapshot().value);
		expect(uiState.inputEnabled).toBe(true); // THE BUG FIX
		expect(uiState.showReady).toBe(false); // Content is LOADED, not UNLOADED
		expect(uiState.showConversation).toBe(true); // Empty conversation, but loaded
	});
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/desktop && bun test session-machine --test-name-pattern="SESSION_CREATED"
```

Expected: FAIL - `SESSION_CREATED` doesn't trigger transition

**Step 3: Add the transition**

```typescript
// In session-machine.ts, update the disconnected state:

connection: {
  initial: ConnectionState.DISCONNECTED,
  states: {
    [ConnectionState.DISCONNECTED]: {
      on: {
        [ConnectionEvent.CONNECT]: ConnectionState.CONNECTING,
        // NEW: Direct transition to READY for new sessions
        [SessionEvent.SESSION_CREATED]: {
          target: ConnectionState.READY,
          actions: ["storeSessionData"],
        },
      },
    },
    // ... rest of states
  },
},

// Also update content region to go to LOADED:
content: {
  initial: ContentState.UNLOADED,
  states: {
    [ContentState.UNLOADED]: {
      on: {
        [ContentEvent.LOAD]: ContentState.LOADING,
        // NEW: New sessions start with empty but loaded content
        [SessionEvent.SESSION_CREATED]: ContentState.LOADED,
      },
    },
    // ... rest
  },
},
```

**Step 4: Run test to verify it passes**

```bash
cd packages/desktop && bun test session-machine --test-name-pattern="SESSION_CREATED"
```

Expected: PASS

**Step 5: Run full machine test suite**

```bash
cd packages/desktop && bun test session-machine
```

Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/lib/acp/logic/session-machine.ts src/lib/acp/logic/__tests__/session-machine.test.ts
git commit -m "feat(session-machine): add SESSION_CREATED event

New sessions transition directly to READY state with LOADED content.
This enables the single-source-of-truth pattern where creating a session
sends one event and all state is derived.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Create Reactive State Store

### Task 2.1: Create SessionStateStore

A new store that wraps the XState machine and exposes reactive Svelte state.

**Files:**

- Create: `src/lib/acp/store/session-state-store.svelte.ts`
- Create: `src/lib/acp/store/__tests__/session-state-store.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/acp/store/__tests__/session-state-store.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { SessionStateStore } from "../session-state-store.svelte.js";
import { ConnectionState, ContentState } from "../../logic/session-machine.js";

describe("SessionStateStore", () => {
	let store: SessionStateStore;

	beforeEach(() => {
		store = new SessionStateStore();
	});

	describe("createSession", () => {
		it("should create machine and transition to READY", () => {
			store.createSession("session-1", {
				modes: [{ id: "build", name: "Build" }],
				models: [{ id: "opus", name: "Opus" }],
				currentModeId: "build",
				currentModelId: "opus",
			});

			const state = store.getState("session-1");
			expect(state).not.toBeNull();
			expect(state!.connection).toBe(ConnectionState.READY);
			expect(state!.content).toBe(ContentState.LOADED);
		});

		it("should expose reactive connectionState", () => {
			store.createSession("session-1", {
				modes: [],
				models: [],
				currentModeId: null,
				currentModelId: null,
			});

			// This would be used in Svelte components with $derived
			const connectionState = store.getConnectionState("session-1");
			expect(connectionState).toBe(ConnectionState.READY);
		});
	});

	describe("getUIState", () => {
		it("should derive inputEnabled from machine state", () => {
			store.createSession("session-1", {
				modes: [],
				models: [],
				currentModeId: null,
				currentModelId: null,
			});

			const uiState = store.getUIState("session-1");
			expect(uiState).not.toBeNull();
			expect(uiState!.inputEnabled).toBe(true);
		});

		it("should return null for unknown session", () => {
			const uiState = store.getUIState("unknown");
			expect(uiState).toBeNull();
		});
	});

	describe("sendMessage flow", () => {
		it("should transition through AWAITING_RESPONSE -> STREAMING -> READY", () => {
			store.createSession("session-1", {
				modes: [],
				models: [],
				currentModeId: null,
				currentModelId: null,
			});

			// Send message
			store.sendEvent("session-1", { type: "SEND_MESSAGE" });
			expect(store.getConnectionState("session-1")).toBe(ConnectionState.AWAITING_RESPONSE);

			// Response starts
			store.sendEvent("session-1", { type: "RESPONSE_STARTED" });
			expect(store.getConnectionState("session-1")).toBe(ConnectionState.STREAMING);

			// Response completes
			store.sendEvent("session-1", { type: "RESPONSE_COMPLETE" });
			expect(store.getConnectionState("session-1")).toBe(ConnectionState.READY);
		});
	});
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/desktop && bun test session-state-store
```

Expected: FAIL - File doesn't exist

**Step 3: Implement the store**

```typescript
// src/lib/acp/store/session-state-store.svelte.ts

import { createActor, type Actor } from "xstate";

import type { Mode, Model } from "./types.js";
import type { SessionUIState } from "../logic/session-ui-state.js";

import {
	sessionMachine,
	type SessionMachineContext,
	type SessionMachineSnapshot,
	ConnectionState,
	deriveSessionUIState,
} from "../logic/session-machine.js";

export interface CreateSessionOptions {
	modes: Mode[];
	models: Model[];
	currentModeId: string | null;
	currentModelId: string | null;
}

type SessionActor = Actor<typeof sessionMachine>;

/**
 * Reactive store for session state machines.
 *
 * This is the SINGLE SOURCE OF TRUTH for session state.
 * All other state (hot state, UI state) derives from the machines here.
 */
export class SessionStateStore {
	// Map of session ID to XState actor
	private machines = $state(new Map<string, SessionActor>());

	/**
	 * Create a new session and its state machine.
	 * The machine immediately transitions to READY state.
	 */
	createSession(sessionId: string, options: CreateSessionOptions): void {
		if (this.machines.has(sessionId)) {
			console.warn(`Session ${sessionId} already exists`);
			return;
		}

		const actor = createActor(sessionMachine, {
			input: { sessionId },
		});

		actor.start();

		// Send the creation event - this transitions to READY
		actor.send({
			type: "SESSION_CREATED",
			modes: options.modes,
			models: options.models,
			currentModeId: options.currentModeId,
			currentModelId: options.currentModelId,
		});

		// Store in reactive map
		const newMap = new Map(this.machines);
		newMap.set(sessionId, actor);
		this.machines = newMap;
	}

	/**
	 * Get the current machine state for a session.
	 */
	getState(sessionId: string): SessionMachineSnapshot | null {
		const actor = this.machines.get(sessionId);
		if (!actor) return null;
		return actor.getSnapshot().value as SessionMachineSnapshot;
	}

	/**
	 * Get the connection state for a session.
	 * This is a convenience method for UI derivation.
	 */
	getConnectionState(sessionId: string): ConnectionState | null {
		const state = this.getState(sessionId);
		return state?.connection ?? null;
	}

	/**
	 * Get derived UI state for a session.
	 */
	getUIState(sessionId: string): SessionUIState | null {
		const state = this.getState(sessionId);
		if (!state) return null;
		return deriveSessionUIState(state);
	}

	/**
	 * Get the machine context (modes, models, errors).
	 */
	getContext(sessionId: string): SessionMachineContext | null {
		const actor = this.machines.get(sessionId);
		if (!actor) return null;
		return actor.getSnapshot().context;
	}

	/**
	 * Send an event to a session's machine.
	 */
	sendEvent(sessionId: string, event: { type: string; [key: string]: unknown }): void {
		const actor = this.machines.get(sessionId);
		if (!actor) {
			console.warn(`Cannot send event to unknown session: ${sessionId}`);
			return;
		}
		actor.send(event);
	}

	/**
	 * Remove a session and stop its machine.
	 */
	removeSession(sessionId: string): void {
		const actor = this.machines.get(sessionId);
		if (actor) {
			actor.stop();
			const newMap = new Map(this.machines);
			newMap.delete(sessionId);
			this.machines = newMap;
		}
	}

	/**
	 * Check if a session exists.
	 */
	hasSession(sessionId: string): boolean {
		return this.machines.has(sessionId);
	}
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/desktop && bun test session-state-store
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/acp/store/session-state-store.svelte.ts src/lib/acp/store/__tests__/session-state-store.test.ts
git commit -m "feat(store): add SessionStateStore as single source of truth

New reactive store that wraps XState machines for each session.
UI state is derived from machine state, eliminating sync bugs.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Integrate with Existing Code

### Task 3.1: Update SessionConnectionManager to Use Machine

**Files:**

- Modify: `src/lib/acp/store/services/session-connection-manager.ts`
- Modify: `src/lib/acp/store/services/session-connection-manager.test.ts`

**Step 1: Write the failing integration test**

```typescript
// Add to session-connection-manager.test.ts

describe("Machine Integration", () => {
	it("should have inputEnabled=true after createSession", async () => {
		// Setup mocks...
		const store = createTestStore();

		const result = await store.createSession({
			projectPath: "/test",
			agentId: "claude-code",
		});

		expect(result.isOk()).toBe(true);

		const sessionId = result.value.id;
		const uiState = store.getSessionUIState(sessionId);

		// THE BUG: This was false before the fix
		expect(uiState?.inputEnabled).toBe(true);
	});

	it("should derive connectionState from machine, not hotState", async () => {
		const store = createTestStore();

		await store.createSession({
			projectPath: "/test",
			agentId: "claude-code",
		});

		const sessionId = "test-session";

		// Verify machine is the source
		const machineState = store.getMachineState(sessionId);
		expect(machineState?.connection).toBe(ConnectionState.READY);

		// Verify UI derives from machine
		const uiState = store.getSessionUIState(sessionId);
		expect(uiState?.inputEnabled).toBe(true);
	});
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/desktop && bun test session-connection-manager --test-name-pattern="Machine Integration"
```

Expected: FAIL - Store doesn't use machine yet

**Step 3: Update createSession to send machine event**

```typescript
// In session-connection-manager.ts, update createSession:

createSession(
  options: { projectPath: string; agentId: string; title?: string },
  eventHandler: SessionEventHandler
): ResultAsync<Session, AppError> {
  return api
    .newSession(options.projectPath, options.agentId)
    .andThen((result) => preferencesStore.ensureLoaded().map(() => result))
    .map((result) => {
      const sessionId = result.sessionId;

      // ... existing mode/model mapping code ...

      const session: Session = {
        // ... existing session creation ...
      };

      this.stateWriter.addSession(session);

      // NEW: Create machine and send SESSION_CREATED event
      // This is now the SINGLE source of truth for connection state
      this.sessionStateStore.createSession(sessionId, {
        modes: availableModes,
        models: availableModels,
        currentModeId: currentMode?.id ?? null,
        currentModelId: currentModel?.id ?? null,
      });

      // REMOVE: No longer set connectionState in hotState
      // The machine IS the source of truth
      this.hotStateManager.updateHotState(sessionId, {
        status: "ready",
        isConnected: true,
        isStreaming: false,
        connectionError: null,
        currentMode,
        currentModel,
        modelPerMode: currentMode ? { [currentMode.id]: currentModel?.id ?? "" } : {},
        // connectionState: REMOVED - now derived from machine
      });

      // ... rest of method ...

      return this.stateReader.getSession(sessionId)!;
    });
}
```

**Step 4: Update getSessionUIState to use machine**

```typescript
// In session-store.svelte.ts:

getSessionUIState(sessionId: string): SessionUIState | null {
  // NEW: Get state from machine (single source of truth)
  return this.sessionStateStore.getUIState(sessionId);

  // REMOVED: No longer derive from hotState
  // const hotState = this.getHotState(sessionId);
  // const connectionState = hotState.connectionState ?? ConnectionState.DISCONNECTED;
}
```

**Step 5: Run test to verify it passes**

```bash
cd packages/desktop && bun test session-connection-manager --test-name-pattern="Machine Integration"
```

Expected: PASS

**Step 6: Run full test suite**

```bash
cd packages/desktop && bun test
```

Expected: All tests PASS

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(session): use machine as single source of truth

- createSession now sends SESSION_CREATED to machine
- getSessionUIState derives from machine, not hotState
- Removes connectionState from hotState (was duplicate state)
- Fixes the missing input field bug permanently

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: Remove Duplicate State

### Task 4.1: Remove connectionState from SessionHotState

**Files:**

- Modify: `src/lib/acp/store/types.ts`
- Modify: `src/lib/acp/store/session-hot-state-store.svelte.ts`
- Modify: `src/lib/acp/store/__tests__/hot-state.test.ts`

**Step 1: Write the test for the new type**

```typescript
// Update hot-state.test.ts

describe("SessionHotState without connectionState", () => {
	it("should not have connectionState field", () => {
		const state: SessionHotState = {
			status: "ready",
			isConnected: true,
			isStreaming: false,
			acpSessionId: "acp-123",
			connectionError: null,
			currentModel: null,
			currentMode: null,
			availableCommands: [],
			modelPerMode: {},
		};

		// TypeScript should prevent this:
		// @ts-expect-error connectionState removed from type
		expect(state.connectionState).toBeUndefined();
	});
});
```

**Step 2: Run test to verify current behavior**

```bash
cd packages/desktop && bun test hot-state --test-name-pattern="without connectionState"
```

Expected: FAIL - connectionState still exists in type

**Step 3: Remove connectionState from types**

```typescript
// In types.ts, update SessionHotState:

export interface SessionHotState {
	status: SessionStatus;
	isConnected: boolean;
	isStreaming: boolean;
	acpSessionId: string | null;
	connectionError: string | null;
	currentModel: Model | null;
	currentMode: Mode | null;
	availableCommands: AvailableCommand[];
	modelPerMode: Record<string, string>;
	// REMOVED: connectionState - now derived from machine
}

export const DEFAULT_HOT_STATE: SessionHotState = {
	status: "idle",
	isConnected: false,
	isStreaming: false,
	acpSessionId: null,
	connectionError: null,
	currentModel: null,
	currentMode: null,
	availableCommands: [],
	modelPerMode: {},
	// REMOVED: connectionState
};
```

**Step 4: Fix all TypeScript errors**

Run type check to find all places that reference connectionState:

```bash
cd packages/desktop && bun run check 2>&1 | grep connectionState
```

Fix each error by removing the connectionState assignment.

**Step 5: Run test to verify it passes**

```bash
cd packages/desktop && bun test hot-state
```

Expected: PASS

**Step 6: Run full test suite and type check**

```bash
cd packages/desktop && bun run check && bun test
```

Expected: No errors

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(types): remove connectionState from SessionHotState

connectionState is now derived from the XState machine.
This eliminates the duplicate state that caused sync bugs.

BREAKING: SessionHotState no longer has connectionState field.
Use sessionStateStore.getConnectionState() instead.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 5: Integration Tests

### Task 5.1: End-to-End State Flow Test

**Files:**

- Create: `src/lib/acp/store/__tests__/session-state-flow.integration.test.ts`

**Step 1: Write the integration test**

```typescript
// src/lib/acp/store/__tests__/session-state-flow.integration.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionStore, createSessionStore } from "../session-store.svelte.js";
import { ConnectionState } from "../../logic/session-machine.js";

/**
 * Integration tests for the complete session state flow.
 * These tests verify the bug is fixed end-to-end.
 */
describe("Session State Flow Integration", () => {
	let store: SessionStore;

	beforeEach(() => {
		// Mock API calls
		vi.mock("../api.js", () => ({
			api: {
				newSession: vi.fn().mockResolvedValue({
					sessionId: "test-session",
					modes: { availableModes: [], currentModeId: null },
					models: { availableModels: [], currentModelId: null },
				}),
				resumeSession: vi.fn().mockResolvedValue({
					modes: { availableModes: [], currentModeId: null },
					models: { availableModels: [], currentModelId: null },
				}),
			},
		}));

		store = createSessionStore();
	});

	describe("THE BUG FIX: New session shows input field", () => {
		it("should have inputEnabled=true immediately after creating session", async () => {
			const result = await store.createSession({
				projectPath: "/test/project",
				agentId: "claude-code",
				title: "Test Session",
			});

			expect(result.isOk()).toBe(true);
			const session = result.value;

			// THE BUG: This was false before because connectionState wasn't set
			const uiState = store.getSessionUIState(session.id);
			expect(uiState).not.toBeNull();
			expect(uiState!.inputEnabled).toBe(true);
		});

		it("should show ready state for new session with no entries", async () => {
			const result = await store.createSession({
				projectPath: "/test/project",
				agentId: "claude-code",
			});

			const session = result.value;
			const uiState = store.getSessionUIState(session.id);

			// New session: content loaded (empty), connection ready
			expect(uiState!.showConversation).toBe(true); // Empty but loaded
			expect(uiState!.inputEnabled).toBe(true);
			expect(uiState!.isReadOnly).toBe(false);
		});
	});

	describe("State transitions via machine", () => {
		it("should transition correctly when sending a message", async () => {
			const result = await store.createSession({
				projectPath: "/test",
				agentId: "claude-code",
			});
			const sessionId = result.value.id;

			// Initial state
			expect(store.getSessionUIState(sessionId)!.inputEnabled).toBe(true);
			expect(store.getSessionUIState(sessionId)!.showThinking).toBe(false);

			// User sends message
			store.sendMachineEvent(sessionId, { type: "SEND_MESSAGE" });
			expect(store.getSessionUIState(sessionId)!.showThinking).toBe(true);
			expect(store.getSessionUIState(sessionId)!.inputEnabled).toBe(false);

			// Response starts
			store.sendMachineEvent(sessionId, { type: "RESPONSE_STARTED" });
			expect(store.getSessionUIState(sessionId)!.showThinking).toBe(false);
			expect(store.getSessionUIState(sessionId)!.showStreaming).toBe(true);

			// Response completes
			store.sendMachineEvent(sessionId, { type: "RESPONSE_COMPLETE" });
			expect(store.getSessionUIState(sessionId)!.showStreaming).toBe(false);
			expect(store.getSessionUIState(sessionId)!.inputEnabled).toBe(true);
		});
	});

	describe("No more dual state bugs", () => {
		it("should not allow setting connectionState via hotState", async () => {
			const result = await store.createSession({
				projectPath: "/test",
				agentId: "claude-code",
			});
			const sessionId = result.value.id;

			// Try to set connectionState via hotState (should be impossible now)
			// This would have caused the bug before
			store.updateHotState(sessionId, {
				status: "ready",
				isConnected: true,
				// connectionState: ConnectionState.DISCONNECTED, // Type error!
			});

			// UI state should still be correct (derived from machine)
			const uiState = store.getSessionUIState(sessionId);
			expect(uiState!.inputEnabled).toBe(true); // Still correct!
		});
	});
});
```

**Step 2: Run integration tests**

```bash
cd packages/desktop && bun test session-state-flow.integration
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/acp/store/__tests__/session-state-flow.integration.test.ts
git commit -m "test(integration): add end-to-end session state flow tests

Verifies the missing input field bug is fixed permanently.
Tests the complete flow from session creation to UI state derivation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

### What Changed

| Before                                            | After                                         |
| ------------------------------------------------- | --------------------------------------------- |
| `connectionState` in hotState (can forget to set) | `connectionState` derived from XState machine |
| Dual state: hotState + machine                    | Single source: machine only                   |
| `hotState.connectionState ?? DISCONNECTED`        | `machine.getState().connection`               |
| 6 layers of indirection                           | 3 layers: UI → Store → Machine                |
| Silent failures                                   | TypeScript enforces valid states              |

### The Bug Fix

```typescript
// Before: Could forget to set connectionState
this.hotStateManager.updateHotState(sessionId, {
	status: "ready",
	isConnected: true,
	// connectionState: READY  ← FORGOT THIS!
});

// After: Machine transition guarantees state
this.sessionStateStore.createSession(sessionId, options);
// Machine transitions to READY automatically
// UI derives inputEnabled from machine state
```

### Files Modified

1. `session-machine.ts` - Added context and SESSION_CREATED event
2. `session-state-store.svelte.ts` - NEW: Reactive machine wrapper
3. `session-connection-manager.ts` - Uses machine instead of hotState
4. `session-store.svelte.ts` - Derives UI from machine
5. `types.ts` - Removed connectionState from SessionHotState
6. Integration tests - Verify bug is fixed

---

**Plan complete and saved to `docs/plans/2026-01-28-deterministic-session-state.md`.**

Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
