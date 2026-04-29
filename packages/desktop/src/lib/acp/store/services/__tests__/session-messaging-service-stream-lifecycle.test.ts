/**
 * Session Messaging Service - Stream Lifecycle Tests
 *
 * Verifies that handleStreamComplete and handleStreamError
 * send the correct machine events without canonical-overlap hot state writes,
 * preventing the UI from getting stuck in "Planning next moves".
 */

import { okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionEntryStore } from "../../session-entry-store.svelte.js";
import type { CanonicalSessionProjection } from "../../canonical-session-projection.js";
import type { IConnectionManager } from "../interfaces/connection-manager.js";
import type { IEntryManager } from "../interfaces/entry-manager.js";
import type { ISessionStateReader } from "../interfaces/session-state-reader.js";
import type { ITransientProjectionManager } from "../interfaces/transient-projection-manager.js";

const createCheckpoint = vi.fn();

// Mock checkpoint store (used by handleStreamComplete → createAutoCheckpointIfNeeded)
// Must be before dynamic import so the mock is registered first.
vi.mock("../../checkpoint-store.svelte.js", () => ({
	checkpointStore: {
		createCheckpoint,
	},
}));

let SessionMessagingService: typeof import("../session-messaging-service.js").SessionMessagingService;

const canonicalOverlapHotStateFields = [
	"status",
	"turnState",
	"connectionError",
	"activeTurnFailure",
	"lastTerminalTurnId",
] as const;

function expectNoCanonicalOverlapHotStateWrites(updateHotState: ReturnType<typeof vi.fn>): void {
	for (const call of updateHotState.mock.calls) {
		const updates = call[1];
		for (const field of canonicalOverlapHotStateFields) {
			expect(Object.prototype.hasOwnProperty.call(updates, field)).toBe(false);
		}
	}
}

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
		startNewAssistantTurn: vi.fn(),
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

function createCanonicalProjection(
	overrides: Partial<CanonicalSessionProjection> = {}
): CanonicalSessionProjection {
	return {
		lifecycle: overrides.lifecycle ?? {
			status: "ready",
			detachedReason: null,
			failureReason: null,
			errorMessage: null,
			actionability: {
				canSend: true,
				canResume: false,
				canRetry: false,
				canArchive: true,
				canConfigure: true,
				recommendedAction: "send",
				recoveryPhase: "none",
				compactStatus: "ready",
			},
		},
		activity: overrides.activity ?? {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
		turnState: overrides.turnState ?? "Idle",
		activeTurnFailure: overrides.activeTurnFailure ?? null,
		lastTerminalTurnId: overrides.lastTerminalTurnId ?? null,
		capabilities: overrides.capabilities ?? {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		},
		revision: overrides.revision ?? {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
	};
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

	it("does not write completed lifecycle state into hot state", () => {
		service.handleStreamComplete(sessionId);

		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("does not clear streaming assistant entry on turn complete", () => {
		service.handleStreamComplete(sessionId);

		expect(deps.entryManager.clearStreamingAssistantEntry).not.toHaveBeenCalled();
	});

	it("sends the machine event without relying on a hot state write", () => {
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

		expect(callOrder).toEqual(["sendResponseComplete"]);
	});

	it("does not let stale completed hot state suppress the stream-complete event", () => {
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

	it("does not treat stale completed hot state as idempotency authority", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "completed",
		});
		(deps.connectionManager.getState as ReturnType<typeof vi.fn>).mockReturnValue({
			content: "loaded",
			connection: "ready",
		});

		service.handleStreamComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("is idempotent when canonical turn state is already completed and machine is ready", () => {
		deps.stateReader.getCanonicalSessionProjection = vi
			.fn()
			.mockReturnValue(createCanonicalProjection({ turnState: "Completed" }));
		(deps.connectionManager.getState as ReturnType<typeof vi.fn>).mockReturnValue({
			content: "loaded",
			connection: "ready",
		});

		service.handleStreamComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).not.toHaveBeenCalled();
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("does not let stale failed hot state suppress a turnComplete", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "error",
			lastTerminalTurnId: "turn-1",
		});

		service.handleStreamComplete(sessionId, "turn-1");

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("ignores a late turnComplete for a canonical failed turn", () => {
		deps.stateReader.getCanonicalSessionProjection = vi.fn().mockReturnValue(
			createCanonicalProjection({
				turnState: "Failed",
				activeTurnFailure: {
					turnId: "turn-1",
					message: "Usage limit reached",
					code: "429",
					kind: "recoverable",
					source: "process",
				},
				lastTerminalTurnId: "turn-1",
			})
		);

		service.handleStreamComplete(sessionId, "turn-1");

		expect(deps.connectionManager.sendResponseComplete).not.toHaveBeenCalled();
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
		expect(deps.entryManager.finalizeStreamingEntries).toHaveBeenCalledWith(sessionId);
	});

	it("does not let stale failed hot state with null turn id suppress a turnComplete", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "error",
			lastTerminalTurnId: null,
		});

		service.handleStreamComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
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

	it("does not write stream errors into canonical-overlap hot state", () => {
		service.handleStreamError(sessionId, new Error("stream broke"));

		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("does not treat canonical idle as terminal when a first stream error arrives", () => {
		deps.stateReader.getCanonicalSessionProjection = vi
			.fn()
			.mockReturnValue(createCanonicalProjection({ turnState: "Idle" }));

		service.handleStreamError(sessionId, new Error("stream broke"));

		expect(deps.connectionManager.sendConnectionError).toHaveBeenCalledWith(sessionId);
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("does not regress canonical failed turns from stale stream errors", () => {
		deps.stateReader.getCanonicalSessionProjection = vi.fn().mockReturnValue(
			createCanonicalProjection({
				turnState: "Failed",
				activeTurnFailure: {
					turnId: "turn-1",
					message: "Usage limit reached",
					code: "429",
					kind: "recoverable",
					source: "process",
				},
				lastTerminalTurnId: "turn-1",
			})
		);

		service.handleStreamError(sessionId, new Error("stream broke"));

		expect(deps.connectionManager.sendConnectionError).toHaveBeenCalledWith(sessionId);
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("clears streaming assistant entry", () => {
		service.handleStreamError(sessionId, new Error("stream broke"));

		expect(deps.entryManager.clearStreamingAssistantEntry).toHaveBeenCalledWith(sessionId);
	});

	it("sends the machine error event without relying on a hot state write", () => {
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

		expect(callOrder).toEqual(["sendConnectionError"]);
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

	it("routes recoverable turn failures through the machine without appending transcript entries", () => {
		service.handleTurnError(sessionId, turnErrorUpdate);

		expect(deps.entryManager.addEntry).not.toHaveBeenCalled();
		expect(deps.connectionManager.sendTurnFailed).toHaveBeenCalledWith(sessionId, {
			turnId: "turn-1",
			message: "You're out of extra usage",
			code: null,
			kind: "recoverable",
			source: "unknown",
		});
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("does not write recoverable turn failures into hot state", () => {
		service.handleTurnError(sessionId, turnErrorUpdate);

		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
	});

	it("stringifies numeric turn error codes before routing the canonical failed-turn event", () => {
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

		expect(deps.connectionManager.sendTurnFailed).toHaveBeenCalledWith(sessionId, {
			turnId: "turn-1",
			message: "Rate limit reached",
			code: "429",
			kind: "recoverable",
			source: "unknown",
		});
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("does not populate header-level connectionError for recoverable turn errors", () => {
		service.handleTurnError(sessionId, turnErrorUpdate);

		expect(deps.connectionManager.sendTurnFailed).toHaveBeenCalledWith(sessionId, {
			turnId: "turn-1",
			message: "You're out of extra usage",
			code: null,
			kind: "recoverable",
			source: "unknown",
		});
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("ignores duplicate canonical terminal errors for the same turn", () => {
		deps.stateReader.getCanonicalSessionProjection = vi.fn().mockReturnValue(
			createCanonicalProjection({
				turnState: "Failed",
				activeTurnFailure: {
					turnId: "turn-1",
					message: "You're out of extra usage",
					code: null,
					kind: "recoverable",
					source: "unknown",
				},
				lastTerminalTurnId: "turn-1",
			})
		);

		service.handleTurnError(sessionId, turnErrorUpdate);

		expect(deps.connectionManager.sendTurnFailed).not.toHaveBeenCalled();
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("ignores duplicate canonical terminal errors when both turn ids are null", () => {
		deps.stateReader.getCanonicalSessionProjection = vi.fn().mockReturnValue(
			createCanonicalProjection({
				turnState: "Failed",
				activeTurnFailure: {
					turnId: null,
					message: "You're out of extra usage",
					code: null,
					kind: "recoverable",
					source: "unknown",
				},
				lastTerminalTurnId: null,
			})
		);

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

	it("does not let stale failed hot state suppress provider streaming updates", () => {
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
			connection: "awaitingResponse",
		});

		service.ensureStreamingState(sessionId);

		expect(deps.connectionManager.sendResponseStarted).toHaveBeenCalledWith(sessionId);
		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
	});

	it("keeps a canonical failed turn terminal when late provider updates arrive", () => {
		deps.stateReader.getCanonicalSessionProjection = vi.fn().mockReturnValue(
			createCanonicalProjection({
				turnState: "Failed",
				activeTurnFailure: {
					turnId: "turn-1",
					message: "Usage limit reached",
					code: "429",
					kind: "recoverable",
					source: "process",
				},
				lastTerminalTurnId: "turn-1",
			})
		);
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "streaming",
			activeTurnFailure: null,
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
