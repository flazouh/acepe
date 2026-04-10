import { beforeEach, describe, expect, it } from "bun:test";

import {
	DEFAULT_HOT_STATE,
	type Session,
	type SessionHotState,
	type SessionStatus,
	type TurnState,
} from "../types.js";

/**
 * Unit tests for the hot state optimization.
 *
 * These tests verify that:
 * 1. Hot state merging works correctly with cold state
 * 2. DEFAULT_HOT_STATE has correct initial values
 * 3. Partial updates to hot state work as expected
 */
describe("SessionHotState", () => {
	describe("DEFAULT_HOT_STATE", () => {
		it("should have idle status", () => {
			expect(DEFAULT_HOT_STATE.status).toBe("idle");
		});

		it("should have isConnected as false", () => {
			expect(DEFAULT_HOT_STATE.isConnected).toBe(false);
		});

		it("should have turnState as idle", () => {
			expect(DEFAULT_HOT_STATE.turnState).toBe("idle");
		});

		it("should have acpSessionId as null", () => {
			expect(DEFAULT_HOT_STATE.acpSessionId).toBe(null);
		});

		it("should have currentModel as null", () => {
			expect(DEFAULT_HOT_STATE.currentModel).toBe(null);
		});

		it("should have currentMode as null", () => {
			expect(DEFAULT_HOT_STATE.currentMode).toBe(null);
		});
	});

	describe("Hot + Cold State Merging", () => {
		const createColdSession = (overrides?: Partial<Session>): Session => ({
			id: "session-1",
			projectPath: "/test/project",
			agentId: "claude-code",
			title: "Test Session",
			status: "idle",
			entries: [],
			entryCount: 0,
			isConnected: false,
			isStreaming: false,
			availableModes: [],
			availableModels: [],
			availableCommands: [],
			currentMode: null,
			currentModel: null,
			taskProgress: null,
			acpSessionId: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
			...overrides,
		});

		it("should override cold state properties with hot state", () => {
			const cold = createColdSession({ status: "idle", isConnected: false });
			const hot: SessionHotState = {
				status: "ready",
				isConnected: true,
				turnState: "idle",
				acpSessionId: "acp-123",
				connectionError: null,
				autonomousEnabled: false,
				autonomousTransition: "idle",
				currentModel: null,
				currentMode: null,
				availableCommands: [],
				statusChangedAt: Date.now(),
			};

			const merged = { ...cold, ...hot };

			expect(merged.status).toBe("ready");
			expect(merged.isConnected).toBe(true);
			expect(merged.acpSessionId).toBe("acp-123");
		});

		it("should preserve cold state properties not in hot state", () => {
			const cold = createColdSession({
				title: "My Session",
				projectPath: "/my/project",
				entryCount: 5,
			});
			const hot: SessionHotState = {
				status: "streaming",
				isConnected: true,
				turnState: "streaming",
				acpSessionId: "acp-456",
				connectionError: null,
				autonomousEnabled: false,
				autonomousTransition: "idle",
				currentModel: null,
				currentMode: null,
				availableCommands: [],
				statusChangedAt: Date.now(),
			};

			const merged = { ...cold, ...hot };

			expect(merged.title).toBe("My Session");
			expect(merged.projectPath).toBe("/my/project");
			expect(merged.entryCount).toBe(5);
			expect(merged.entries).toEqual([]);
		});

		it("should use DEFAULT_HOT_STATE when no hot state exists", () => {
			const cold = createColdSession({ status: "connecting" });
			const hot = DEFAULT_HOT_STATE;

			const merged = { ...cold, ...hot };

			// Hot state overrides cold state
			expect(merged.status).toBe("idle");
			expect(merged.isConnected).toBe(false);
		});
	});

	describe("Partial Hot State Updates", () => {
		it("should merge partial updates into existing hot state", () => {
			const current: SessionHotState = {
				status: "idle",
				isConnected: false,
				turnState: "idle",
				acpSessionId: null,
				connectionError: null,
				autonomousEnabled: false,
				autonomousTransition: "idle",
				currentModel: null,
				currentMode: null,
				availableCommands: [],
				statusChangedAt: Date.now(),
			};

			const updates: Partial<SessionHotState> = {
				status: "connecting",
			};

			const updated = { ...current, ...updates };

			expect(updated.status).toBe("connecting");
			expect(updated.isConnected).toBe(false);
			expect(updated.turnState).toBe("idle");
			expect(updated.acpSessionId).toBe(null);
		});

		it("should update multiple properties at once", () => {
			const current: SessionHotState = {
				status: "connecting",
				isConnected: false,
				turnState: "idle",
				acpSessionId: null,
				connectionError: null,
				autonomousEnabled: false,
				autonomousTransition: "idle",
				currentModel: null,
				currentMode: null,
				availableCommands: [],
				statusChangedAt: Date.now(),
			};

			const updates: Partial<SessionHotState> = {
				status: "ready",
				isConnected: true,
				acpSessionId: "acp-789",
			};

			const updated = { ...current, ...updates };

			expect(updated.status).toBe("ready");
			expect(updated.isConnected).toBe(true);
			expect(updated.turnState).toBe("idle");
			expect(updated.acpSessionId).toBe("acp-789");
		});
	});
});

describe("Hot State Map Operations", () => {
	let hotStateMap: Map<string, SessionHotState>;

	beforeEach(() => {
		hotStateMap = new Map();
	});

	describe("updateSessionHotState behavior", () => {
		const updateSessionHotState = (
			id: string,
			updates: Partial<SessionHotState>
		): Map<string, SessionHotState> => {
			const current = hotStateMap.get(id) ?? DEFAULT_HOT_STATE;
			const updated = { ...current, ...updates };
			const newMap = new Map(hotStateMap);
			newMap.set(id, updated);
			return newMap;
		};

		it("should create new entry for unknown session", () => {
			hotStateMap = updateSessionHotState("new-session", {
				status: "connecting",
			});

			const state = hotStateMap.get("new-session");
			expect(state).toBeDefined();
			expect(state?.status).toBe("connecting");
			expect(state?.isConnected).toBe(false);
		});

		it("should update existing entry", () => {
			hotStateMap.set("existing-session", {
				status: "connecting",
				isConnected: false,
				turnState: "idle",
				acpSessionId: null,
				connectionError: null,
				autonomousEnabled: false,
				autonomousTransition: "idle",
				currentModel: null,
				currentMode: null,
				availableCommands: [],
				statusChangedAt: Date.now(),
			});

			hotStateMap = updateSessionHotState("existing-session", {
				status: "ready",
				isConnected: true,
				acpSessionId: "acp-123",
			});

			const state = hotStateMap.get("existing-session");
			expect(state?.status).toBe("ready");
			expect(state?.isConnected).toBe(true);
			expect(state?.acpSessionId).toBe("acp-123");
		});

		it("should create new Map reference on each update", () => {
			const originalMap = hotStateMap;
			hotStateMap = updateSessionHotState("session-1", { status: "connecting" });

			expect(hotStateMap).not.toBe(originalMap);
		});

		it("should not affect other sessions when updating one", () => {
			hotStateMap.set("session-1", {
				status: "ready",
				isConnected: true,
				turnState: "idle",
				acpSessionId: "acp-1",
				connectionError: null,
				autonomousEnabled: false,
				autonomousTransition: "idle",
				currentModel: null,
				currentMode: null,
				availableCommands: [],
				statusChangedAt: Date.now(),
			});
			hotStateMap.set("session-2", {
				status: "idle",
				isConnected: false,
				turnState: "idle",
				acpSessionId: null,
				connectionError: null,
				autonomousEnabled: false,
				autonomousTransition: "idle",
				currentModel: null,
				currentMode: null,
				availableCommands: [],
				statusChangedAt: Date.now(),
			});

			hotStateMap = updateSessionHotState("session-1", {
				status: "streaming",
				turnState: "streaming",
			});

			// Session 1 updated
			expect(hotStateMap.get("session-1")?.status).toBe("streaming");
			expect(hotStateMap.get("session-1")?.turnState).toBe("streaming");

			// Session 2 unchanged
			expect(hotStateMap.get("session-2")?.status).toBe("idle");
			expect(hotStateMap.get("session-2")?.isConnected).toBe(false);
		});
	});

	describe("getHotState behavior", () => {
		const getHotState = (sessionId: string): SessionHotState => {
			return hotStateMap.get(sessionId) ?? DEFAULT_HOT_STATE;
		};

		it("should return DEFAULT_HOT_STATE for unknown session", () => {
			const state = getHotState("unknown-session");
			expect(state).toEqual(DEFAULT_HOT_STATE);
		});

		it("should return stored state for known session", () => {
			const storedState: SessionHotState = {
				status: "streaming",
				isConnected: true,
				turnState: "streaming",
				acpSessionId: "acp-999",
				connectionError: null,
				autonomousEnabled: false,
				autonomousTransition: "idle",
				currentModel: null,
				currentMode: null,
				availableCommands: [],
				statusChangedAt: Date.now(),
			};
			hotStateMap.set("known-session", storedState);

			const state = getHotState("known-session");
			expect(state).toEqual(storedState);
		});
	});
});

describe("Sessions Array Independence", () => {
	/**
	 * This test verifies the core optimization:
	 * Hot state updates should NOT require recreating the sessions array.
	 */
	it("should not require sessions array modification for hot state updates", () => {
		// Simulate the sessions array
		const sessions: Session[] = [
			{
				id: "session-1",
				projectPath: "/project-1",
				agentId: "claude-code",
				title: "Session 1",
				status: "idle",
				entries: [],
				entryCount: 0,
				isConnected: false,
				isStreaming: false,
				availableModes: [],
				availableModels: [],
				availableCommands: [],
				currentMode: null,
				currentModel: null,
				taskProgress: null,
				acpSessionId: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				parentId: null,
			},
			{
				id: "session-2",
				projectPath: "/project-2",
				agentId: "claude-code",
				title: "Session 2",
				status: "idle",
				entries: [],
				entryCount: 0,
				isConnected: false,
				isStreaming: false,
				availableModes: [],
				availableModels: [],
				availableCommands: [],
				currentMode: null,
				currentModel: null,
				taskProgress: null,
				acpSessionId: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				parentId: null,
			},
		];

		// Store original array reference
		const originalArrayRef = sessions;

		// Simulate hot state map
		let hotStateMap = new Map<string, SessionHotState>();

		// Update hot state (this should NOT modify sessions array)
		const updateHotState = (id: string, updates: Partial<SessionHotState>) => {
			const current = hotStateMap.get(id) ?? DEFAULT_HOT_STATE;
			const newMap = new Map(hotStateMap);
			newMap.set(id, { ...current, ...updates });
			hotStateMap = newMap;
		};

		// Perform hot state update
		updateHotState("session-1", { status: "connecting" });
		updateHotState("session-1", { status: "ready", isConnected: true });

		// Verify sessions array was NOT modified
		expect(sessions).toBe(originalArrayRef);
		expect(sessions.length).toBe(2);

		// Verify hot state was updated
		expect(hotStateMap.get("session-1")?.status).toBe("ready");
		expect(hotStateMap.get("session-1")?.isConnected).toBe(true);

		// Verify we can merge to get correct session state
		const sessionById = new Map(sessions.map((s) => [s.id, s]));
		const cold = sessionById.get("session-1")!;
		const hot = hotStateMap.get("session-1") ?? DEFAULT_HOT_STATE;
		const merged = { ...cold, ...hot };

		expect(merged.status).toBe("ready");
		expect(merged.isConnected).toBe(true);
		expect(merged.title).toBe("Session 1"); // Cold state preserved
	});
});

describe("Status Transition Scenarios", () => {
	const createHotState = (
		status: SessionStatus,
		turnState: TurnState = "idle"
	): SessionHotState => ({
		status,
		isConnected: status === "ready" || status === "streaming",
		turnState,
		acpSessionId: status === "idle" ? null : "acp-123",
		connectionError: null,
		autonomousEnabled: false,
		autonomousTransition: "idle",
		currentModel: null,
		currentMode: null,
		availableCommands: [],
		statusChangedAt: Date.now(),
	});

	describe("Session Connection Flow", () => {
		it("should transition from idle -> connecting -> ready", () => {
			let state = DEFAULT_HOT_STATE;

			// Click session -> connecting
			state = { ...state, status: "connecting" };
			expect(state.status).toBe("connecting");
			expect(state.isConnected).toBe(false);

			// API responds -> ready
			state = {
				...state,
				status: "ready",
				isConnected: true,
				acpSessionId: "acp-123",
			};
			expect(state.status).toBe("ready");
			expect(state.isConnected).toBe(true);
			expect(state.acpSessionId).toBe("acp-123");
		});

		it("should transition from idle -> connecting -> error on failure", () => {
			let state = DEFAULT_HOT_STATE;

			// Click session -> connecting
			state = { ...state, status: "connecting" };
			expect(state.status).toBe("connecting");

			// API fails -> error
			state = { ...state, status: "error", isConnected: false };
			expect(state.status).toBe("error");
			expect(state.isConnected).toBe(false);
		});
	});

	describe("Message Streaming Flow", () => {
		it("should transition from ready -> streaming -> ready", () => {
			let state = createHotState("ready");

			// Send message -> streaming
			state = { ...state, status: "streaming", turnState: "streaming" };
			expect(state.status).toBe("streaming");
			expect(state.turnState).toBe("streaming");

			// Stream complete -> ready
			state = { ...state, status: "ready", turnState: "completed" };
			expect(state.status).toBe("ready");
			expect(state.turnState).toBe("completed");
		});

		it("should transition from streaming -> error on stream failure", () => {
			let state = createHotState("streaming", "streaming");
			expect(state.turnState).toBe("streaming");

			// Stream error
			state = { ...state, status: "error", turnState: "error" };
			expect(state.status).toBe("error");
			expect(state.turnState).toBe("error");
		});
	});

	describe("Disconnect Flow", () => {
		it("should transition from ready -> idle on disconnect", () => {
			let state = createHotState("ready");
			expect(state.isConnected).toBe(true);

			// Disconnect - reset to DEFAULT_HOT_STATE (using spread)
			state = { ...DEFAULT_HOT_STATE };
			expect(state.status).toBe("idle");
			expect(state.isConnected).toBe(false);
		});
	});
});
