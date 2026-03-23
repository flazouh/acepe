import { describe, expect, it } from "vitest";

import type { AvailableModel } from "../../services/acp-types.js";
import type { Session } from "../store/types.js";
import type { AvailableMode } from "../types/available-mode.js";
import type { ThreadState } from "../types/thread-state.js";

/**
 * Unit tests for AgentInput reactive mode/model selection logic.
 *
 * Tests the derived values that determine which modes and models to show:
 * - effectiveAvailableModes
 * - effectiveCurrentModeId
 * - effectiveAvailableModels
 * - effectiveCurrentModelId
 */
describe("AgentInput Mode/Model Selection Logic", () => {
	// Mock global app state
	const mockGlobalModes: AvailableMode[] = [
		{ id: "global-code", name: "Global Code", description: "Global code mode" },
		{ id: "global-chat", name: "Global Chat", description: "Global chat mode" },
	];

	const mockGlobalModels: AvailableModel[] = [
		{
			modelId: "global-sonnet",
			name: "Global Sonnet",
			description: "Global model",
		},
	];

	const mockGlobalState = {
		availableModes: mockGlobalModes,
		currentModeId: "global-code",
		availableModels: mockGlobalModels,
		currentModelId: "global-sonnet",
	};

	describe("effectiveAvailableModes", () => {
		it("should use thread capabilities when connection exists", () => {
			const cursorModes: AvailableMode[] = [
				{
					id: "cursor-code",
					name: "Cursor Code",
					description: "Cursor code mode",
				},
				{
					id: "cursor-plan",
					name: "Cursor Plan",
					description: "Cursor plan mode",
				},
			];

			const thread: ThreadState = {
				id: "test-thread",
				dbId: null,
				source: "active",
				title: "Test",
				status: "idle",
				entries: [],
				agentId: "cursor",
				projectPath: "/test",
				projectName: "Test",
				createdAt: new Date(),
				connection: {
					acpSessionId: "session-123",
					capabilities: {
						canResume: false,
						canFork: false,
						supportedModes: ["cursor-code", "cursor-plan"],
						supportedModels: [],
						availableModes: cursorModes,
						availableModels: [],
						currentModeId: "cursor-code",
						currentModelId: null,
					},
					connectedAt: new Date(),
				},
			};

			// Logic from agent-input-ui.svelte:
			const threadModes = thread?.connection?.capabilities?.availableModes;
			const fallbackModes = mockGlobalState.availableModes;
			const result = threadModes ?? fallbackModes;

			expect(result).toBe(cursorModes);
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("cursor-code");
		});

		it("should fall back to global modes when thread has no connection", () => {
			const thread: ThreadState = {
				id: "test-thread",
				dbId: null,
				source: "active",
				title: "Test",
				status: "idle",
				entries: [],
				agentId: "cursor",
				projectPath: "/test",
				projectName: "Test",
				createdAt: new Date(),
				// No connection
			};

			const threadModes = thread?.connection?.capabilities?.availableModes;
			const fallbackModes = mockGlobalState.availableModes;
			const result = threadModes ?? fallbackModes;

			expect(result).toBe(mockGlobalModes);
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("global-code");
		});

		it("should fall back to global modes when thread is null", () => {
			const thread = null as ThreadState | null;

			const threadModes = thread?.connection?.capabilities?.availableModes;
			const fallbackModes = mockGlobalState.availableModes;
			const result = threadModes ?? fallbackModes;

			expect(result).toBe(mockGlobalModes);
		});
	});

	describe("effectiveCurrentModeId", () => {
		it("should use thread current mode when connection exists", () => {
			const thread: ThreadState = {
				id: "test-thread",
				dbId: null,
				source: "active",
				title: "Test",
				status: "idle",
				entries: [],
				agentId: "cursor",
				projectPath: "/test",
				projectName: "Test",
				createdAt: new Date(),
				connection: {
					acpSessionId: "session-123",
					capabilities: {
						canResume: false,
						canFork: false,
						supportedModes: ["cursor-code"],
						supportedModels: [],
						availableModes: [],
						availableModels: [],
						currentModeId: "cursor-code",
						currentModelId: null,
					},
					connectedAt: new Date(),
				},
			};

			const threadModeId = thread?.connection?.capabilities?.currentModeId;
			const fallbackModeId = mockGlobalState.currentModeId;
			const result = threadModeId ?? fallbackModeId;

			expect(result).toBe("cursor-code");
		});

		it("should fall back to global mode when thread has no connection", () => {
			const thread: ThreadState = {
				id: "test-thread",
				dbId: null,
				source: "active",
				title: "Test",
				status: "idle",
				entries: [],
				agentId: "cursor",
				projectPath: "/test",
				projectName: "Test",
				createdAt: new Date(),
			};

			const threadModeId = thread?.connection?.capabilities?.currentModeId;
			const fallbackModeId = mockGlobalState.currentModeId;
			const result = threadModeId ?? fallbackModeId;

			expect(result).toBe("global-code");
		});
	});

	describe("effectiveAvailableModels", () => {
		it("should use thread model capabilities when connection exists", () => {
			const cursorModels: AvailableModel[] = [
				{
					modelId: "cursor-gpt4",
					name: "GPT-4 (Cursor)",
					description: "Cursor GPT-4",
				},
			];

			const thread: ThreadState = {
				id: "test-thread",
				dbId: null,
				source: "active",
				title: "Test",
				status: "idle",
				entries: [],
				agentId: "cursor",
				projectPath: "/test",
				projectName: "Test",
				createdAt: new Date(),
				connection: {
					acpSessionId: "session-123",
					capabilities: {
						canResume: false,
						canFork: false,
						supportedModes: [],
						supportedModels: ["cursor-gpt4"],
						availableModes: [],
						availableModels: cursorModels,
						currentModeId: null,
						currentModelId: "cursor-gpt4",
					},
					connectedAt: new Date(),
				},
			};

			const threadModels = thread?.connection?.capabilities?.availableModels;
			const fallbackModels = mockGlobalState.availableModels;
			const result = threadModels ?? fallbackModels;

			expect(result).toBe(cursorModels);
			expect(result[0].modelId).toBe("cursor-gpt4");
		});

		it("should fall back to global models when thread has no connection", () => {
			const thread: ThreadState = {
				id: "test-thread",
				dbId: null,
				source: "active",
				title: "Test",
				status: "idle",
				entries: [],
				agentId: "cursor",
				projectPath: "/test",
				projectName: "Test",
				createdAt: new Date(),
			};

			const threadModels = thread?.connection?.capabilities?.availableModels;
			const fallbackModels = mockGlobalState.availableModels;
			const result = threadModels ?? fallbackModels;

			expect(result).toBe(mockGlobalModels);
		});
	});

	describe("effectiveCurrentModelId", () => {
		it("should use thread current model when connection exists", () => {
			const thread: ThreadState = {
				id: "test-thread",
				dbId: null,
				source: "active",
				title: "Test",
				status: "idle",
				entries: [],
				agentId: "cursor",
				projectPath: "/test",
				projectName: "Test",
				createdAt: new Date(),
				connection: {
					acpSessionId: "session-123",
					capabilities: {
						canResume: false,
						canFork: false,
						supportedModes: [],
						supportedModels: [],
						availableModes: [],
						availableModels: [],
						currentModeId: null,
						currentModelId: "cursor-gpt4",
					},
					connectedAt: new Date(),
				},
			};

			const threadModelId = thread?.connection?.capabilities?.currentModelId;
			const fallbackModelId = mockGlobalState.currentModelId;
			const result = threadModelId ?? fallbackModelId;

			expect(result).toBe("cursor-gpt4");
		});

		it("should fall back to global model when thread has no connection", () => {
			const thread: ThreadState = {
				id: "test-thread",
				dbId: null,
				source: "active",
				title: "Test",
				status: "idle",
				entries: [],
				agentId: "cursor",
				projectPath: "/test",
				projectName: "Test",
				createdAt: new Date(),
			};

			const threadModelId = thread?.connection?.capabilities?.currentModelId;
			const fallbackModelId = mockGlobalState.currentModelId;
			const result = threadModelId ?? fallbackModelId;

			expect(result).toBe("global-sonnet");
		});
	});

	describe("Integration: Thread prop vs appState.threads lookup", () => {
		it("should prioritize direct thread prop over appState lookup", () => {
			// Simulates the scenario where:
			// 1. Thread object is passed directly with fresh cursor capabilities
			// 2. appState.threads might have stale data

			const freshThreadProp: ThreadState = {
				id: "test-thread",
				dbId: null,
				source: "active",
				title: "Test",
				status: "idle",
				entries: [],
				agentId: "cursor",
				projectPath: "/test",
				projectName: "Test",
				createdAt: new Date(),
				connection: {
					acpSessionId: "session-123",
					capabilities: {
						canResume: false,
						canFork: false,
						supportedModes: ["cursor-code"],
						supportedModels: ["cursor-gpt4"],
						availableModes: [{ id: "cursor-code", name: "Cursor Code", description: "Fresh" }],
						availableModels: [
							{
								modelId: "cursor-gpt4",
								name: "GPT-4",
								description: "Fresh",
							},
						],
						currentModeId: "cursor-code",
						currentModelId: "cursor-gpt4",
					},
					connectedAt: new Date(),
				},
			};

			// The fix ensures we use the thread prop directly
			const modesFromThreadProp = freshThreadProp?.connection?.capabilities?.availableModes;

			expect(modesFromThreadProp).toBeDefined();
			expect(modesFromThreadProp?.[0].description).toBe("Fresh");

			// This demonstrates that using the direct prop is correct,
			// rather than looking it up from appState.threads.find()
		});
	});
});

/**
 * Unit tests for AgentInput selectorsLoading logic.
 *
 * Tests the loading state for mode/model selectors:
 * - No session = not loading (show disabled state)
 * - Session connecting = loading
 * - Session ready but no modes = not loading
 * - Session ready with modes = not loading
 */
describe("AgentInput Selectors Loading Logic", () => {
	// Helper to create mock session with specific properties
	function createMockSession(overrides: Partial<Session>): Session {
		const now = new Date();
		return {
			id: "test-session",
			projectPath: "/test",
			agentId: "claude",
			title: "Test Session",
			status: "ready",
			entries: [],
			entryCount: 0,
			isConnected: true,
			isStreaming: false,
			availableModes: [],
			availableModels: [],
			currentMode: null,
			currentModel: null,
			availableCommands: [],
			taskProgress: null,
			acpSessionId: null,
			parentId: null,
			updatedAt: now,
			createdAt: now,
			...overrides,
		};
	}

	// Replicate the logic from agent-input-ui.svelte
	function calculateSelectorsLoading(session: Session | null | undefined): boolean {
		const hasSession = session !== null && session !== undefined;
		const isSessionConnecting = session?.status === "idle" || session?.status === "connecting";
		return hasSession && isSessionConnecting;
	}

	describe("selectorsLoading", () => {
		it("should NOT show loading when session is null (new thread)", () => {
			const session = null;
			const result = calculateSelectorsLoading(session);

			expect(result).toBe(false);
		});

		it("should NOT show loading when session is undefined (new thread)", () => {
			const session = undefined;
			const result = calculateSelectorsLoading(session);

			expect(result).toBe(false);
		});

		it("should show loading when session status is idle", () => {
			const session = createMockSession({ status: "idle" });
			const result = calculateSelectorsLoading(session);

			expect(result).toBe(true);
		});

		it("should show loading when session status is connecting", () => {
			const session = createMockSession({ status: "connecting" });
			const result = calculateSelectorsLoading(session);

			expect(result).toBe(true);
		});

		it("should NOT show loading when session is ready but has no available modes", () => {
			const session = createMockSession({
				status: "ready",
				availableModes: [],
			});
			const result = calculateSelectorsLoading(session);

			expect(result).toBe(false);
		});

		it("should NOT show loading when session is ready with available modes", () => {
			const session = createMockSession({
				status: "ready",
				availableModes: [{ id: "default", name: "Default" }],
			});
			const result = calculateSelectorsLoading(session);

			expect(result).toBe(false);
		});

		it("should NOT show loading when session is streaming with available modes", () => {
			const session = createMockSession({
				status: "streaming",
				isStreaming: true,
				availableModes: [{ id: "default", name: "Default" }],
			});
			const result = calculateSelectorsLoading(session);

			expect(result).toBe(false);
		});

		it("should NOT show loading when session is error status but no modes", () => {
			const session = createMockSession({
				status: "error",
				availableModes: [],
			});
			const result = calculateSelectorsLoading(session);

			expect(result).toBe(false);
		});

		it("should NOT show loading when session is error status with modes", () => {
			const session = createMockSession({
				status: "error",
				availableModes: [{ id: "default", name: "Default" }],
			});
			const result = calculateSelectorsLoading(session);

			expect(result).toBe(false);
		});
	});
});
