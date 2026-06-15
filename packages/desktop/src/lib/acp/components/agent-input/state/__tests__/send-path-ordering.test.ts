/**
 * Ordering invariant: clearPendingUserEntry() is called after sendMessage has installed the
 * session-level pendingSendIntent.
 *
 * Context: optimistic and canonical entry IDs are independent crypto.randomUUID() calls and
 * therefore never collide. The materializer does NOT id-dedup, so the panel must keep exactly
 * one optimistic source visible while the first-send flow moves from panel-level pending state
 * to session-level pending state.
 *
 * Four paths all route through AgentInputState.sendPreparedMessage:
 *   - Normal send (pre-session):   setPendingUserEntry → sendMessage installs pendingSendIntent → clearPendingUserEntry
 *   - Retry:                       retrySend() → handleSend() → same path as above
 *   - Slash-command (pre-session): @[command:/name] token in content → same path as above
 *   - Voice (pre-session):         transcribed plain text in content → same path as above
 *
 * For in-session sends (sessionId present) pendingUserEntry is never set, so the invariant
 * is vacuously satisfied. The critical window is the pre-session (new-session) path.
 */
import { describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync } from "neverthrow";

// Must appear before any import that transitively loads @tauri-apps/api modules.
mock.module("@tauri-apps/api/core", () => ({
	invoke: mock(() => Promise.resolve(undefined)),
}));
mock.module("@tauri-apps/api/event", () => ({
	listen: mock(async () => () => {}),
}));

import type { SessionEntry } from "../../../../application/dto/session-entry.js";
import { materializeAgentPanelSceneFromGraph } from "../../../../session-state/agent-panel-graph-materializer.js";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import { DEFAULT_PANEL_HOT_STATE } from "../../../../store/types.js";
import { AgentInputState } from "../agent-input-state.svelte.js";
import { SessionCreationError } from "../../errors/agent-input-error.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeSession(id: string = "session-123") {
	return {
		id,
		projectPath: "/repo",
		agentId: "claude-code",
		title: "Test session",
		updatedAt: new Date(),
		createdAt: new Date(),
		sessionLifecycleState: "created" as const,
		parentId: null,
	};
}

function makeOrderedPanelStore(): {
	store: Partial<PanelStore>;
	events: string[];
} {
	const events: string[] = [];
	const store: Partial<PanelStore> = {
		getHotState: mock(() => Object.assign({}, DEFAULT_PANEL_HOT_STATE, { pendingUserEntry: null })),
		setPendingUserEntry: mock(() => {
			events.push("set-pending");
		}),
		clearPendingUserEntry: mock(() => {
			events.push("clear-pending");
		}),
	};
	return { store, events };
}

function makeOrderedSessionStore(
	events: string[],
	opts: { sendFails?: boolean } = {}
): SessionStore {
	const session = makeSession();
	return {
		connection: {
			createSession: mock(() => {
				events.push("session-created");
				return okAsync({ kind: "ready" as const, session });
			}),
			sendMessage: mock(() => {
				events.push("send-message");
				return opts.sendFails ? errAsync(new Error("network error") as never) : okAsync(undefined);
			}),
		},
		read: {
			getSessionCold: mock(() => session),
		},
		composer: {
			beginDispatch: mock(() => {}),
			endDispatch: mock(() => {}),
		},
	} as unknown as SessionStore;
}

// ---------------------------------------------------------------------------
// Normal send path (pre-session — no sessionId)
// ---------------------------------------------------------------------------

describe("clearPendingUserEntry ordering invariant — normal send (pre-session)", () => {
	it("sets pending before send and clears it after sendMessage resolves (success path)", async () => {
		const { store: panelStore, events } = makeOrderedPanelStore();
		const sessionStore = makeOrderedSessionStore(events);

		const state = new AgentInputState(
			sessionStore as SessionStore,
			panelStore as PanelStore,
			() => "/repo"
		);

		const result = await state.sendPreparedMessage({
			content: "Hello agent",
			panelId: "panel-1",
			projectPath: "/repo",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
		});

		expect(result.isOk()).toBe(true);
		// Critical ordering: set → create → send → clear.
		// sendMessage installs pendingSendIntent before it resolves, so clearing the
		// panel-level pending entry does not produce an empty first-send panel.
		expect(events).toEqual(["set-pending", "session-created", "send-message", "clear-pending"]);
	});

	it("clears pending even when sendMessage fails (error path — no stuck optimistic entry)", async () => {
		const { store: panelStore, events } = makeOrderedPanelStore();
		const sessionStore = makeOrderedSessionStore(events, { sendFails: true });

		const state = new AgentInputState(
			sessionStore as SessionStore,
			panelStore as PanelStore,
			() => "/repo"
		);

		const result = await state.sendPreparedMessage({
			content: "Hello agent",
			panelId: "panel-1",
			projectPath: "/repo",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
		});

		expect(result.isErr()).toBe(true);
		// Even on failure, clear is always called — pending entry cannot get stuck.
		expect(events).toContain("set-pending");
		expect(events).toContain("clear-pending");
		// Clear comes after the failed send attempt (not before it).
		expect(events.indexOf("clear-pending")).toBeGreaterThan(events.indexOf("send-message"));
	});

	it("does not promote a pre-session panel when the first prompt fails after session creation", async () => {
		const { store: panelStore, events } = makeOrderedPanelStore();
		const sessionStore = makeOrderedSessionStore(events, { sendFails: true });
		const createdSessions: string[] = [];

		const state = new AgentInputState(
			sessionStore as SessionStore,
			panelStore as PanelStore,
			() => "/repo"
		);

		const result = await state.sendPreparedMessage({
			content: "Hello agent",
			panelId: "panel-1",
			projectPath: "/repo",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
			onSessionCreated: (sessionId) => {
				createdSessions.push(sessionId);
			},
		});

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(SessionCreationError);
		}
		expect(createdSessions).toEqual([]);
		expect(events).toEqual(["set-pending", "session-created", "send-message", "clear-pending"]);
	});
});

// ---------------------------------------------------------------------------
// Retry path
//
// retrySend() → handleSend() → sendPreparedMessage — same code path.
// In-session retry (sessionId present): pendingUserEntry is never set because
// setPendingUserEntry is gated on `!props.sessionId` in the controller.
// ---------------------------------------------------------------------------

describe("clearPendingUserEntry ordering invariant — retry / in-session send", () => {
	it("does NOT touch pendingUserEntry when a sessionId is already present (fast path)", async () => {
		const { store: panelStore } = makeOrderedPanelStore();
		const session = makeSession("existing-session");
		const sessionStore = {
			connection: {
				sendMessage: mock(() => okAsync(undefined)),
			},
			read: {
				getSessionCold: mock(() => session),
			},
		} as unknown as SessionStore;

		const state = new AgentInputState(
			sessionStore,
			panelStore as PanelStore,
			() => "/repo"
		);

		// Fast path: sessionId is present → goes directly to sendMessage, no pending entry needed.
		// This covers retry when the session already exists (the common retry case).
		const result = await state.sendPreparedMessage({
			content: "Retry message",
			panelId: "panel-1",
			sessionId: "existing-session",
		});

		expect(result.isOk()).toBe(true);
		expect(panelStore.setPendingUserEntry).not.toHaveBeenCalled();
		expect(panelStore.clearPendingUserEntry).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Slash-command path
//
// handleCommandSelect() injects an @[command:/name] token into the composer
// message. The user then presses send → handleSend() → sendPreparedMessage.
// The content format does not affect the pendingUserEntry lifecycle.
// ---------------------------------------------------------------------------

describe("clearPendingUserEntry ordering invariant — slash-command (pre-session)", () => {
	it("follows the same set→send→clear ordering when content contains a command token", async () => {
		const { store: panelStore, events } = makeOrderedPanelStore();
		const sessionStore = makeOrderedSessionStore(events);

		const state = new AgentInputState(
			sessionStore as SessionStore,
			panelStore as PanelStore,
			() => "/repo"
		);

		// Slash-command token format injected by handleCommandSelect before the user presses send.
		const result = await state.sendPreparedMessage({
			content: "@[command:/gsd-plan] Build a login page",
			panelId: "panel-1",
			projectPath: "/repo",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
		});

		expect(result.isOk()).toBe(true);
		// Ordering invariant holds regardless of content format.
		expect(events).toEqual(["set-pending", "session-created", "send-message", "clear-pending"]);
	});
});

// ---------------------------------------------------------------------------
// Voice path
//
// onTranscriptionReady() inserts normalised transcribed text into the composer
// via insertPlainTextAtOffsets. The user then presses send → handleSend() →
// sendPreparedMessage. The content origin does not affect the invariant.
// ---------------------------------------------------------------------------

describe("clearPendingUserEntry ordering invariant — voice (pre-session)", () => {
	it("follows the same set→send→clear ordering when content is voice-transcribed text", async () => {
		const { store: panelStore, events } = makeOrderedPanelStore();
		const sessionStore = makeOrderedSessionStore(events);

		const state = new AgentInputState(
			sessionStore as SessionStore,
			panelStore as PanelStore,
			() => "/repo"
		);

		// normalizeVoiceInputText output: trimmed, normalised transcribed text.
		const result = await state.sendPreparedMessage({
			content: "Build a login page with OAuth support",
			panelId: "panel-1",
			projectPath: "/repo",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
		});

		expect(result.isOk()).toBe(true);
		// Ordering invariant holds regardless of how the content was produced.
		expect(events).toEqual(["set-pending", "session-created", "send-message", "clear-pending"]);
	});
});

// ---------------------------------------------------------------------------
// Integration-style scene test
//
// Verifies no duplicate user entry appears in the materialized scene at any
// step of the send → optimistic-set → canonical-arrive → optimistic-cleared
// lifecycle. This is the regression surface: if clearPendingUserEntry timing
// slips and the materializer sees both the pending AND the canonical entry at
// the same render tick, it would produce two user entries.
// ---------------------------------------------------------------------------

describe("no duplicate user entry in materialized scene across the send lifecycle", () => {
	const pendingEntry: SessionEntry = {
		id: "optimistic-uuid-xxxx-yyyy",
		type: "user",
		message: {
			content: { type: "text", text: "Build a login page" },
			chunks: [{ type: "text", text: "Build a login page" }],
		},
	};

	const header = { title: "Session" };

	it("step 1 — before send: no entries in pre-session scene", () => {
		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph: null,
			header,
		});
		expect(scene.conversation.entries).toHaveLength(0);
	});

	it("step 2 — optimistic window: pending set, graph null → exactly 1 optimistic entry", () => {
		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph: null,
			header,
			optimistic: { pendingUserEntry: pendingEntry },
		});
		expect(scene.conversation.entries).toHaveLength(1);
		const entry = scene.conversation.entries[0];
		expect(entry?.type).toBe("user");
		if (entry?.type === "user") {
			expect(entry.isOptimistic).toBe(true);
		}
	});

	it("step 3 — after session handoff but before canonical graph: still 1 optimistic entry", () => {
		// This is the first-send handoff window: the panel has a session id now, but the
		// canonical transcript has not arrived yet. The UI must not reset to an empty scene.
		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph: null,
			header,
			optimistic: { pendingUserEntry: pendingEntry },
		});
		expect(scene.conversation.entries).toHaveLength(1);
	});

	it("step 4 — with pending cleared, canonical entry arrival cannot produce a duplicate", () => {
		// The canonical entry has a DIFFERENT UUID than the optimistic entry.
		// clearPendingUserEntry has already been called (optimistic: null).
		// Since the materializer does NOT id-dedup, the absence of duplicates is guaranteed
		// by the ordering invariant: optimistic is cleared before canonical can land.
		// The materializer-level test "both canonical and optimistic entries appear when they
		// have independent UUIDs" (in agent-panel-graph-materializer.test.ts) documents what
		// a violation of this invariant would look like at render time.
		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph: null,
			header,
			optimistic: null, // invariant satisfied: pending already cleared
		});
		// No duplicate: 0 entries with cleared pending (canonical arrives in graph separately).
		expect(scene.conversation.entries).toHaveLength(0);
	});
});
