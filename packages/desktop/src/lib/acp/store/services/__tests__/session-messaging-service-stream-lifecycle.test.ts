/**
 * Session Messaging Service - Stream Lifecycle Tests
 *
 * Verifies that handleStreamComplete and handleStreamError
 * send the correct machine events alongside hot state updates,
 * preventing the UI from getting stuck in "Planning next moves".
 */

import { okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionEntryStore } from "../../session-entry-store.svelte.js";
import type { IConnectionManager } from "../interfaces/connection-manager.js";
import type { IEntryManager } from "../interfaces/entry-manager.js";
import type { ITransientProjectionManager } from "../interfaces/transient-projection-manager.js";
import type { ISessionStateReader } from "../interfaces/session-state-reader.js";

const createCheckpoint = vi.fn();

// Mock checkpoint store (used by handleStreamComplete → createAutoCheckpointIfNeeded)
// Must be before dynamic import so the mock is registered first.
vi.mock("../../checkpoint-store.svelte.js", () => ({
	checkpointStore: {
		createCheckpoint,
	},
}));

let SessionMessagingService: typeof import("../session-messaging-service.js").SessionMessagingService;

function createMockDeps() {
	const stateReader: ISessionStateReader = {
		getHotState: vi.fn(),
		getEntries: vi.fn().mockReturnValue([]),
		isPreloaded: vi.fn(),
		getSessionsForProject: vi.fn(),
		getSessionCold: vi.fn().mockReturnValue(null),
		getAllSessions: vi.fn(),
	};

	const hotStateManager: ITransientProjectionManager = {
		getHotState: vi.fn(),
		hasHotState: vi.fn(),
		updateHotState: vi.fn(),
		removeHotState: vi.fn(),
		initializeHotState: vi.fn(),
	};

	const entryManager: IEntryManager = {
		getEntries: vi.fn(),
		hasEntries: vi.fn(),
		isPreloaded: vi.fn(),
		markPreloaded: vi.fn(),
		unmarkPreloaded: vi.fn(),
		storeEntriesAndBuildIndex: vi.fn(),
		addEntry: vi.fn(),
		removeEntry: vi.fn(),
		updateEntry: vi.fn(),
		clearEntries: vi.fn(),
		createToolCallEntry: vi.fn(),
		updateToolCallEntry: vi.fn(),
		aggregateAssistantChunk: vi.fn(),
		clearStreamingAssistantEntry: vi.fn(),
		finalizeStreamingEntries: vi.fn(),
	};

	const connectionManager: IConnectionManager = {
		createOrGetMachine: vi.fn(),
		getMachine: vi.fn(),
		getState: vi.fn(),
		removeMachine: vi.fn(),
		isConnecting: vi.fn(),
		setConnecting: vi.fn(),
		sendContentLoad: vi.fn(),
		sendContentLoaded: vi.fn(),
		sendContentLoadError: vi.fn(),
		sendConnectionConnect: vi.fn(),
		sendConnectionSuccess: vi.fn(),
		sendCapabilitiesLoaded: vi.fn(),
		sendConnectionError: vi.fn(),
		sendTurnFailed: vi.fn(),
		sendDisconnect: vi.fn(),
		sendMessageSent: vi.fn(),
		sendResponseStarted: vi.fn(),
		sendResponseComplete: vi.fn(),
		initializeConnectedSession: vi.fn(),
	};

	return { stateReader, hotStateManager, entryManager, connectionManager };
}

describe("SessionMessagingService.handleStreamComplete", () => {
	const sessionId = "session-1";
	let service: InstanceType<typeof SessionMessagingService>;
	let deps: ReturnType<typeof createMockDeps>;

	beforeAll(async () => {
		const module = await import("../session-messaging-service.js");
		SessionMessagingService = module.SessionMessagingService;
	});

	beforeEach(() => {
		deps = createMockDeps();
		createCheckpoint.mockReturnValue(
			okAsync({
				id: "checkpoint-1",
				sessionId,
				checkpointNumber: 1,
				name: null,
				createdAt: Date.now(),
				toolCallId: null,
				isAuto: true,
				fileCount: 1,
				totalLinesAdded: 1,
				totalLinesRemoved: 0,
			})
		);
		service = new SessionMessagingService(
			deps.stateReader,
			deps.hotStateManager,
			deps.entryManager,
			deps.connectionManager
		);
	});

	it("sends sendResponseComplete to transition machine to READY", () => {
		service.handleStreamComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
	});

	it("updates hot state to ready and not streaming", () => {
		service.handleStreamComplete(sessionId);

		expect(deps.hotStateManager.updateHotState).toHaveBeenCalledWith(sessionId, {
			status: "ready",
			turnState: "completed",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
		});
	});

	it("does not clear streaming assistant entry on turn complete", () => {
		service.handleStreamComplete(sessionId);

		expect(deps.entryManager.clearStreamingAssistantEntry).not.toHaveBeenCalled();
	});

	it("sends machine event before hot state update", () => {
		const callOrder: string[] = [];
		(deps.connectionManager.sendResponseComplete as ReturnType<typeof vi.fn>).mockImplementation(
			() => {
				callOrder.push("sendResponseComplete");
			}
		);
		(deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callOrder.push("updateHotState");
		});

		service.handleStreamComplete(sessionId);

		expect(callOrder).toEqual(["sendResponseComplete", "updateHotState"]);
	});

	it("still completes the session machine when hot state is completed but the machine is still streaming", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "completed",
		});
		(deps.connectionManager.getState as ReturnType<typeof vi.fn>).mockReturnValue({
			content: "loaded",
			connection: "streaming",
		});

		service.handleStreamComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
		expect(deps.entryManager.finalizeStreamingEntries).toHaveBeenCalledWith(sessionId);
	});

	it("is idempotent when the turn is already completed and the machine is already ready", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "completed",
		});
		(deps.connectionManager.getState as ReturnType<typeof vi.fn>).mockReturnValue({
			content: "loaded",
			connection: "ready",
		});

		service.handleStreamComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).not.toHaveBeenCalled();
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("ignores a late turnComplete for a turn that already failed", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "error",
			lastTerminalTurnId: "turn-1",
		});

		service.handleStreamComplete(sessionId, "turn-1");

		expect(deps.connectionManager.sendResponseComplete).not.toHaveBeenCalled();
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("ignores a late turnComplete when both terminal updates have null turn ids", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "error",
			lastTerminalTurnId: null,
		});

		service.handleStreamComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).not.toHaveBeenCalled();
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("finalizes streaming entries so pending tool calls stop shimmering", () => {
		service.handleStreamComplete(sessionId);

		expect(deps.entryManager.finalizeStreamingEntries).toHaveBeenCalledWith(sessionId);
	});

	it("passes agent context when creating auto-checkpoints", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "streaming",
		});
		(deps.stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "opencode",
			title: "Test Session",
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		});
		(deps.stateReader.getEntries as ReturnType<typeof vi.fn>).mockReturnValue([
			{
				id: "tool-call-1",
				type: "tool_call",
				timestamp: new Date(),
				message: {
					id: "tool-call-1",
					kind: "edit",
					status: "completed",
					name: "Edit",
					title: "Edit file",
					arguments: {
						kind: "edit",
						file_path: "/tmp/project/src/app.ts",
						old_string: "old",
						new_string: "new",
					},
				},
			},
		]);

		service.handleStreamComplete(sessionId);

		expect(createCheckpoint).toHaveBeenCalledWith(
			sessionId,
			"/tmp/project",
			["/tmp/project/src/app.ts"],
			expect.objectContaining({
				isAuto: true,
				agentId: "opencode",
			})
		);
	});
});

describe("SessionMessagingService.handleStreamError", () => {
	const sessionId = "session-1";
	let service: InstanceType<typeof SessionMessagingService>;
	let deps: ReturnType<typeof createMockDeps>;

	beforeAll(async () => {
		const module = await import("../session-messaging-service.js");
		SessionMessagingService = module.SessionMessagingService;
	});

	beforeEach(() => {
		deps = createMockDeps();
		service = new SessionMessagingService(
			deps.stateReader,
			deps.hotStateManager,
			deps.entryManager,
			deps.connectionManager
		);
	});

	it("sends sendConnectionError to transition machine to ERROR", () => {
		service.handleStreamError(sessionId, new Error("stream broke"));

		expect(deps.connectionManager.sendConnectionError).toHaveBeenCalledWith(sessionId);
	});

	it("updates hot state with error status and message", () => {
		service.handleStreamError(sessionId, new Error("stream broke"));

		expect(deps.hotStateManager.updateHotState).toHaveBeenCalledWith(sessionId, {
			status: "error",
			turnState: "error",
			connectionError: "stream broke",
			activeTurnFailure: null,
			lastTerminalTurnId: null,
		});
	});

	it("clears streaming assistant entry", () => {
		service.handleStreamError(sessionId, new Error("stream broke"));

		expect(deps.entryManager.clearStreamingAssistantEntry).toHaveBeenCalledWith(sessionId);
	});

	it("sends machine event before hot state update", () => {
		const callOrder: string[] = [];
		(deps.connectionManager.sendConnectionError as ReturnType<typeof vi.fn>).mockImplementation(
			() => {
				callOrder.push("sendConnectionError");
			}
		);
		(deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callOrder.push("updateHotState");
		});

		service.handleStreamError(sessionId, new Error("stream broke"));

		expect(callOrder).toEqual(["sendConnectionError", "updateHotState"]);
	});
});

describe("SessionMessagingService.handleTurnError", () => {
	const sessionId = "session-1";
	const turnErrorUpdate = {
		type: "turnError" as const,
		session_id: sessionId,
		turn_id: "turn-1",
		error: {
			message: "You're out of extra usage",
			kind: "recoverable" as const,
			source: "unknown" as const,
		},
	};
	let service: InstanceType<typeof SessionMessagingService>;
	let deps: ReturnType<typeof createMockDeps>;

	beforeAll(async () => {
		const module = await import("../session-messaging-service.js");
		SessionMessagingService = module.SessionMessagingService;
	});

	beforeEach(() => {
		deps = createMockDeps();
		service = new SessionMessagingService(
			deps.stateReader,
			deps.hotStateManager,
			deps.entryManager,
			deps.connectionManager
		);
	});

	it("stores recoverable turn failures in hot state instead of appending transcript entries", () => {
		service.handleTurnError(sessionId, turnErrorUpdate);

		expect(deps.entryManager.addEntry).not.toHaveBeenCalled();
		expect(deps.hotStateManager.updateHotState).toHaveBeenCalledWith(sessionId, {
			status: "ready",
			turnState: "error",
			connectionError: null,
			activeTurnFailure: {
				turnId: "turn-1",
				message: "You're out of extra usage",
				code: null,
				kind: "recoverable",
				source: "unknown",
			},
			lastTerminalTurnId: "turn-1",
		});
	});

	it("stringifies numeric turn error codes in canonical failed-turn state", () => {
		service.handleTurnError(sessionId, {
			type: "turnError",
			session_id: sessionId,
			turn_id: "turn-1",
			error: {
				message: "Rate limit reached",
				kind: "recoverable",
				source: "unknown",
				code: 429,
			},
		});

		expect(deps.hotStateManager.updateHotState).toHaveBeenCalledWith(sessionId, {
			status: "ready",
			turnState: "error",
			connectionError: null,
			activeTurnFailure: {
				turnId: "turn-1",
				message: "Rate limit reached",
				code: "429",
				kind: "recoverable",
				source: "unknown",
			},
			lastTerminalTurnId: "turn-1",
		});
	});

	it("does not populate header-level connectionError for recoverable turn errors", () => {
		service.handleTurnError(sessionId, turnErrorUpdate);

		expect(deps.hotStateManager.updateHotState).toHaveBeenCalledWith(sessionId, {
			status: "ready",
			turnState: "error",
			connectionError: null,
			activeTurnFailure: {
				turnId: "turn-1",
				message: "You're out of extra usage",
				code: null,
				kind: "recoverable",
				source: "unknown",
			},
			lastTerminalTurnId: "turn-1",
		});
	});

	it("ignores duplicate terminal errors for the same turn", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			turnState: "error",
			activeTurnFailure: {
				turnId: "turn-1",
				message: "You're out of extra usage",
				code: null,
				kind: "recoverable",
				source: "unknown",
			},
			lastTerminalTurnId: "turn-1",
		});

		service.handleTurnError(sessionId, turnErrorUpdate);

		expect(deps.connectionManager.sendTurnFailed).not.toHaveBeenCalled();
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("ignores duplicate terminal errors when both turn ids are null", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			turnState: "error",
			activeTurnFailure: {
				turnId: null,
				message: "You're out of extra usage",
				code: null,
				kind: "recoverable",
				source: "unknown",
			},
			lastTerminalTurnId: null,
		});

		service.handleTurnError(sessionId, {
			type: "turnError",
			session_id: sessionId,
			turn_id: null,
			error: {
				message: "You're out of extra usage",
				kind: "recoverable",
				source: "unknown",
			},
		});

		expect(deps.connectionManager.sendTurnFailed).not.toHaveBeenCalled();
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});
});

describe("SessionMessagingService.ensureStreamingState", () => {
	const sessionId = "session-1";
	let service: InstanceType<typeof SessionMessagingService>;
	let deps: ReturnType<typeof createMockDeps>;

	beforeAll(async () => {
		const module = await import("../session-messaging-service.js");
		SessionMessagingService = module.SessionMessagingService;
	});

	beforeEach(() => {
		deps = createMockDeps();
		service = new SessionMessagingService(
			deps.stateReader,
			deps.hotStateManager,
			deps.entryManager,
			deps.connectionManager
		);
	});

	it("keeps a failed turn terminal when late provider updates arrive", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "error",
			activeTurnFailure: {
				turnId: "turn-1",
				message: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "process",
			},
		});
		(deps.connectionManager.getState as ReturnType<typeof vi.fn>).mockReturnValue({
			connection: "streaming",
		});

		service.ensureStreamingState(sessionId);

		expect(deps.connectionManager.sendResponseStarted).not.toHaveBeenCalled();
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});
});

describe("SessionMessagingService replay regression", () => {
	const sessionId = "session-replay";
	let service: InstanceType<typeof SessionMessagingService>;
	let entryStore: SessionEntryStore;

	beforeAll(async () => {
		const module = await import("../session-messaging-service.js");
		SessionMessagingService = module.SessionMessagingService;
	});

	beforeEach(() => {
		entryStore = new SessionEntryStore();
		entryStore.storeEntriesAndBuildIndex(sessionId, []);

		const stateReader: ISessionStateReader = {
			getHotState: vi.fn(),
			getEntries: vi.fn().mockImplementation((id: string) => entryStore.getEntries(id)),
			isPreloaded: vi.fn(),
			getSessionsForProject: vi.fn(),
			getSessionCold: vi.fn().mockReturnValue(undefined),
			getAllSessions: vi.fn(),
		};

		const hotStateManager: ITransientProjectionManager = {
			getHotState: vi.fn().mockReturnValue({ turnState: "streaming" }),
			hasHotState: vi.fn(),
			updateHotState: vi.fn(),
			removeHotState: vi.fn(),
			initializeHotState: vi.fn(),
		};

		const connectionManager: IConnectionManager = {
			createOrGetMachine: vi.fn(),
			getMachine: vi.fn(),
			getState: vi.fn().mockReturnValue(undefined),
			removeMachine: vi.fn(),
			isConnecting: vi.fn(),
			setConnecting: vi.fn(),
			sendContentLoad: vi.fn(),
			sendContentLoaded: vi.fn(),
			sendContentLoadError: vi.fn(),
			sendConnectionConnect: vi.fn(),
			sendConnectionSuccess: vi.fn(),
			sendCapabilitiesLoaded: vi.fn(),
			sendConnectionError: vi.fn(),
			sendTurnFailed: vi.fn(),
			sendDisconnect: vi.fn(),
			sendMessageSent: vi.fn(),
			sendResponseStarted: vi.fn(),
			sendResponseComplete: vi.fn(),
			initializeConnectedSession: vi.fn(),
		};

		service = new SessionMessagingService(
			stateReader,
			hotStateManager,
			entryStore,
			connectionManager
		);
	});

	it("merges post-turn trailing chunk without message_id into the same assistant entry", async () => {
		const first = await service.aggregateAssistantChunk(
			sessionId,
			{ content: { type: "text", text: "I see the" } },
			"msg-thread-1",
			false
		);
		expect(first.isOk()).toBe(true);

		const second = await service.aggregateAssistantChunk(
			sessionId,
			{ content: { type: "text", text: " component." } },
			"msg-thread-1",
			false
		);
		expect(second.isOk()).toBe(true);

		service.handleStreamComplete(sessionId);

		const trailing = await service.aggregateAssistantChunk(
			sessionId,
			{ content: { type: "text", text: " test it." } },
			undefined,
			false
		);
		expect(trailing.isOk()).toBe(true);

		const assistantEntries = entryStore
			.getEntries(sessionId)
			.filter((entry) => entry.type === "assistant");
		expect(assistantEntries).toHaveLength(1);

		const onlyEntry = assistantEntries[0];
		if (onlyEntry.type === "assistant") {
			const combinedText = onlyEntry.message.chunks
				.map((chunk) => (chunk.block.type === "text" ? chunk.block.text : ""))
				.join("");
			expect(combinedText).toBe("I see the component. test it.");
		}
	});
});
