/**
 * Session Messaging Service - Stream Lifecycle Tests
 *
 * Verifies that handleCanonicalTurnComplete and handleCanonicalTurnFailure
 * send the correct machine events without canonical-overlap transient projection writes,
 * preventing the UI from getting stuck in "Planning next moves".
 */

import { okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
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

const canonicalOverlapTransientProjectionFields = [
	"status",
	"turnState",
	"connectionError",
	"activeTurnFailure",
	"lastTerminalTurnId",
] as const;

function expectNoCanonicalOverlapTransientProjectionWrites(updateTransientProjection: ReturnType<typeof vi.fn>): void {
	for (const call of updateTransientProjection.mock.calls) {
		const updates = call[1];
		for (const field of canonicalOverlapTransientProjectionFields) {
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
		getSessionTurnState: vi.fn().mockReturnValue(null),
		getSessionLastTerminalTurnId: vi.fn().mockReturnValue(null),
		getGraphTranscriptRevision: vi.fn().mockReturnValue(undefined),
		getSessionAutonomousEnabled: vi.fn().mockReturnValue(null),
		getSessionCurrentModeId: vi.fn().mockReturnValue(null),
		getSessionAvailableModels: vi.fn().mockReturnValue([]),
		getSessionAvailableModes: vi.fn().mockReturnValue([]),
		getSessionToolCalls: vi.fn().mockReturnValue([]),
		getSessionModifiedFilesState: vi.fn().mockReturnValue(null),
		isPreloaded: vi.fn(),
		hasSessionCanonicalProjection: vi.fn().mockReturnValue(false),
		getSessionCold: vi.fn().mockReturnValue(null),
		getSessionIdentity: vi.fn().mockReturnValue(undefined),
		getSessionMetadata: vi.fn().mockReturnValue(undefined),
		getAllSessions: vi.fn(),
	};

	const transientProjectionManager: ITransientProjectionManager = {
		getTransientProjection: vi.fn(),
		hasTransientProjection: vi.fn(),
		updateTransientProjection: vi.fn(),
		removeTransientProjection: vi.fn(),
		initializeTransientProjection: vi.fn(),
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
		isResponseInProgress: vi.fn(),
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

	return { stateReader, transientProjectionManager, entryManager, connectionManager };
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
			deps.transientProjectionManager,
			deps.entryManager,
			deps.connectionManager
		);
	});

	it("sends sendResponseComplete to transition machine to READY", () => {
		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
	});

	it("does not write completed lifecycle state into transient projection", () => {
		service.handleCanonicalTurnComplete(sessionId);

		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
		);
		expect(deps.transientProjectionManager.updateTransientProjection).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				pendingSendIntent: null,
			})
		);
	});

	it("does not record terminal turn state in the transient projection", () => {
		service.handleCanonicalTurnComplete(sessionId, "turn-1");

		expect(deps.transientProjectionManager.updateTransientProjection).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				pendingSendIntent: null,
			})
		);
		const updates = (deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>).mock.calls.map(
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
		(deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callOrder.push("updateTransientProjection");
		});

		service.handleCanonicalTurnComplete(sessionId);

		expect(callOrder).toEqual(["updateTransientProjection", "sendResponseComplete"]);
		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
		);
	});

	it("does not let stale completed transient projection suppress the stream-complete event", () => {
		(deps.transientProjectionManager.getTransientProjection as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "completed",
		});
		(deps.connectionManager.isResponseInProgress as ReturnType<typeof vi.fn>).mockReturnValue(true);

		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
		);
		expect(deps.entryManager.finalizeStreamingEntries).toHaveBeenCalledWith(sessionId);
	});

	it("does not treat stale completed transient projection as idempotency authority", () => {
		(deps.transientProjectionManager.getTransientProjection as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "completed",
		});
		(deps.connectionManager.isResponseInProgress as ReturnType<typeof vi.fn>).mockReturnValue(true);

		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
		);
	});

	it("is idempotent when canonical turn state is already completed and machine is ready", () => {
		deps.stateReader.getSessionTurnState = vi.fn().mockReturnValue("Completed");
		(deps.connectionManager.isResponseInProgress as ReturnType<typeof vi.fn>).mockReturnValue(false);

		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).not.toHaveBeenCalled();
		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
		);
	});

	it("does not let stale failed transient projection suppress a turnComplete", () => {
		(deps.transientProjectionManager.getTransientProjection as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "error",
			lastTerminalTurnId: "turn-1",
		});

		service.handleCanonicalTurnComplete(sessionId, "turn-1");

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
		);
	});

	it("ignores a late turnComplete for a canonical failed turn", () => {
		deps.stateReader.getSessionTurnState = vi.fn().mockReturnValue("Failed");
		deps.stateReader.getSessionLastTerminalTurnId = vi.fn().mockReturnValue("turn-1");

		service.handleCanonicalTurnComplete(sessionId, "turn-1");

		expect(deps.connectionManager.sendResponseComplete).not.toHaveBeenCalled();
		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
		);
		expect(deps.entryManager.finalizeStreamingEntries).toHaveBeenCalledWith(sessionId);
	});

	it("does not let stale failed transient projection with null turn id suppress a turnComplete", () => {
		(deps.transientProjectionManager.getTransientProjection as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "error",
			lastTerminalTurnId: null,
		});

		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
		);
	});

	it("finalizes streaming entries so pending tool calls stop shimmering", () => {
		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.entryManager.finalizeStreamingEntries).toHaveBeenCalledWith(sessionId);
	});

	it("passes agent context when creating auto-checkpoints", () => {
		(deps.transientProjectionManager.getTransientProjection as ReturnType<typeof vi.fn>).mockReturnValue({
			turnState: "streaming",
		});
		(deps.stateReader.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "opencode",
		});
		const modifiedFilesState: ModifiedFilesState = {
			files: [
				{
					filePath: "/tmp/project/src/app.ts",
					fileName: "app.ts",
					editCount: 1,
					totalAdded: 1,
					totalRemoved: 1,
					originalContent: null,
					finalContent: null,
				},
			],
			byPath: new Map(),
			fileCount: 1,
			totalEditCount: 1,
		};
		(deps.stateReader.getSessionModifiedFilesState as ReturnType<typeof vi.fn>).mockReturnValue(
			modifiedFilesState
		);

		service.handleCanonicalTurnComplete(sessionId);

		expect(deps.stateReader.getSessionToolCalls).not.toHaveBeenCalled();
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
			deps.transientProjectionManager,
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
		expect(deps.transientProjectionManager.updateTransientProjection).not.toHaveBeenCalled();
	});

	it("does not write recoverable turn failures into transient projection", () => {
		service.handleCanonicalTurnFailure(sessionId, turnErrorUpdate);

		expect(deps.transientProjectionManager.updateTransientProjection).not.toHaveBeenCalled();
		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
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
		expect(deps.transientProjectionManager.updateTransientProjection).not.toHaveBeenCalled();
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
		expect(deps.transientProjectionManager.updateTransientProjection).not.toHaveBeenCalled();
	});

	it("ignores duplicate canonical terminal errors for the same turn", () => {
		deps.stateReader.getSessionTurnState = vi.fn().mockReturnValue("Failed");
		deps.stateReader.getSessionLastTerminalTurnId = vi.fn().mockReturnValue("turn-1");

		service.handleCanonicalTurnFailure(sessionId, turnErrorUpdate);

		expect(deps.connectionManager.sendTurnFailed).not.toHaveBeenCalled();
		expect(deps.transientProjectionManager.updateTransientProjection).not.toHaveBeenCalled();
	});

	it("ignores duplicate canonical terminal errors when both turn ids are null", () => {
		deps.stateReader.getSessionTurnState = vi.fn().mockReturnValue("Failed");
		deps.stateReader.getSessionLastTerminalTurnId = vi.fn().mockReturnValue(null);

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
		expect(deps.transientProjectionManager.updateTransientProjection).not.toHaveBeenCalled();
	});
});
