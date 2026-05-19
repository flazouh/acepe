/**
 * Session Messaging Service - Stream Lifecycle Tests
 *
 * Verifies that handleCanonicalTurnComplete and handleCanonicalTurnFailure
 * send the correct machine events without canonical-overlap hot state writes,
 * preventing the UI from getting stuck in "Planning next moves".
 */

import { okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalSessionProjection } from "../../canonical-session-projection.js";
import type { ToolCall } from "../../../types/tool-call.js";
import type { IConnectionManager } from "../interfaces/connection-manager.js";
import type { IEntryManager } from "../interfaces/entry-manager.js";
import type { ISessionStateReader } from "../interfaces/session-state-reader.js";
import type { ITransientProjectionManager } from "../interfaces/transient-projection-manager.js";

const createCheckpoint = vi.fn();

// Mock checkpoint store (used by handleCanonicalTurnComplete → createAutoCheckpointIfNeeded)
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
			expect(Object.hasOwn(updates, field)).toBe(false);
		}
	}
}

function createMockDeps() {
	const stateReader: ISessionStateReader = {
		getSessionAcpSessionId: vi.fn().mockReturnValue(null),
		getSessionAutonomousTransitionBusy: vi.fn().mockReturnValue(false),
		getSessionCanSend: vi.fn().mockReturnValue(null),
		getSessionLifecycleStatus: vi.fn().mockReturnValue(null),
		getGraphTranscriptRevision: vi.fn().mockReturnValue(undefined),
		getSessionAutonomousEnabled: vi.fn().mockReturnValue(null),
		getSessionCurrentModeId: vi.fn().mockReturnValue(null),
		getSessionCapabilities: vi.fn().mockReturnValue({
			availableModels: [],
			availableModes: [],
			availableCommands: [],
		}),
		getCanonicalSessionProjection: vi.fn().mockReturnValue(null),
		getSessionToolCalls: vi.fn().mockReturnValue([]),
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
		isPreloaded: vi.fn(),
		markPreloaded: vi.fn(),
		clearEntries: vi.fn(),
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
		activeStreamingTail: overrides.activeStreamingTail ?? null,
		capabilities: overrides.capabilities ?? {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		},
		tokenStream: overrides.tokenStream ?? new Map(),
		clockAnchor: overrides.clockAnchor ?? null,
		revision: overrides.revision ?? {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
	};
}

describe("SessionMessagingService.handleCanonicalTurnComplete", () => {
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
		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
	});

	it("does not write completed lifecycle state into hot state", () => {
		service.handleCanonicalTurnComplete(sessionId);

		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
		expect(deps.hotStateManager.updateHotState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				pendingSendIntent: null,
			})
		);
	});

	it("does not record terminal turn state in the transient projection", () => {
		service.handleCanonicalTurnComplete(sessionId, "turn-1");

		expect(deps.hotStateManager.updateHotState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				pendingSendIntent: null,
			})
		);
		const updates = (deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>).mock.calls.map(
			(call) => call[1]
		);
		expect(updates).not.toContainEqual(
			expect.objectContaining({ observedTerminalTurn: expect.anything() })
		);
	});

	it("clears local pending send before sending the machine complete event", () => {
		const callOrder: string[] = [];
		(deps.connectionManager.sendResponseComplete as ReturnType<typeof vi.fn>).mockImplementation(
			() => {
				callOrder.push("sendResponseComplete");
			}
		);
		(deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callOrder.push("updateHotState");
		});

		service.handleCanonicalTurnComplete(sessionId);

		expect(callOrder).toEqual(["updateHotState", "sendResponseComplete"]);
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
	});

	it("does not let stale completed hot state suppress the stream-complete event", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "completed",
		});
		(deps.connectionManager.getState as ReturnType<typeof vi.fn>).mockReturnValue({
			content: "loaded",
			connection: "streaming",
		});

		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
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

		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
	});

	it("is idempotent when canonical turn state is already completed and machine is ready", () => {
		deps.stateReader.getCanonicalSessionProjection = vi
			.fn()
			.mockReturnValue(createCanonicalProjection({ turnState: "Completed" }));
		(deps.connectionManager.getState as ReturnType<typeof vi.fn>).mockReturnValue({
			content: "loaded",
			connection: "ready",
		});

		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).not.toHaveBeenCalled();
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
	});

	it("does not let stale failed hot state suppress a turnComplete", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "error",
			lastTerminalTurnId: "turn-1",
		});

		service.handleCanonicalTurnComplete(sessionId, "turn-1");

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
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

		service.handleCanonicalTurnComplete(sessionId, "turn-1");

		expect(deps.connectionManager.sendResponseComplete).not.toHaveBeenCalled();
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
		expect(deps.entryManager.finalizeStreamingEntries).toHaveBeenCalledWith(sessionId);
	});

	it("does not let stale failed hot state with null turn id suppress a turnComplete", () => {
		(deps.hotStateManager.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "error",
			lastTerminalTurnId: null,
		});

		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
	});

	it("finalizes streaming entries so pending tool calls stop shimmering", () => {
		service.handleCanonicalTurnComplete(sessionId);

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
		(deps.stateReader.getSessionToolCalls as ReturnType<typeof vi.fn>).mockReturnValue([
			{
				id: "tool-call-1",
				name: "Edit",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/tmp/project/src/app.ts",
							oldString: "old",
							newString: "new",
							content: null,
						},
					],
				},
				status: "completed",
				kind: "edit",
				title: "Edit file",
				awaitingPlanApproval: false,
			} satisfies ToolCall,
		]);

		service.handleCanonicalTurnComplete(sessionId);

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

describe("SessionMessagingService.handleCanonicalTurnFailure", () => {
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
		service.handleCanonicalTurnFailure(sessionId, turnErrorUpdate);
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
		service.handleCanonicalTurnFailure(sessionId, turnErrorUpdate);

		expect(deps.hotStateManager.updateHotState).not.toHaveBeenCalled();
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
	});

	it("stringifies numeric turn error codes before routing the canonical failed-turn event", () => {
		service.handleCanonicalTurnFailure(sessionId, {
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
		service.handleCanonicalTurnFailure(sessionId, turnErrorUpdate);

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

		service.handleCanonicalTurnFailure(sessionId, turnErrorUpdate);

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

		service.handleCanonicalTurnFailure(sessionId, {
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
