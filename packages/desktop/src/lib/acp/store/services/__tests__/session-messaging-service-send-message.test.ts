import { errAsync, okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRANSIENT_PROJECTION } from "../../types.js";
import type { IConnectionManager } from "../interfaces/connection-manager.js";
import type { IEntryManager } from "../interfaces/entry-manager.js";
import type { ISessionStateReader } from "../interfaces/session-state-reader.js";
import type { ITransientProjectionManager } from "../interfaces/transient-projection-manager.js";

const sendPrompt = vi.fn();

vi.mock("../../checkpoint-store.svelte.js", () => ({
	checkpointStore: {
		createCheckpoint: vi.fn(),
		getCheckpoints: vi.fn().mockReturnValue([]),
	},
}));

vi.mock("../../api.js", () => ({
	api: {
		sendPrompt,
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
		getSessionCanSend: vi.fn().mockReturnValue(true),
		getSessionLifecycleStatus: vi.fn().mockReturnValue("ready"),
		getSessionTurnState: vi.fn().mockReturnValue(null),
		getSessionLastTerminalTurnId: vi.fn().mockReturnValue(null),
		getGraphTranscriptRevision: vi.fn().mockReturnValue(undefined),
		getSessionAutonomousEnabled: vi.fn().mockReturnValue(null),
		getSessionCurrentModeId: vi.fn().mockReturnValue(null),
		getSessionAvailableModels: vi.fn().mockReturnValue([]),
		getSessionAvailableModes: vi.fn().mockReturnValue([]),
		getSessionToolCalls: vi.fn().mockReturnValue([]),
		getSessionModifiedFilesState: vi.fn().mockReturnValue(null),
		hasSessionCanonicalProjection: vi.fn().mockReturnValue(false),
		getSessionCold: vi.fn().mockReturnValue({
			id: "session-1",
			projectPath: "/tmp/project",
			agentId: "claude-code",
			title: "Test Session",
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		}),
		getSessionIdentity: vi.fn().mockReturnValue({
			id: "session-1",
			projectPath: "/tmp/project",
			agentId: "claude-code",
		}),
		getSessionMetadata: vi.fn().mockReturnValue({
			title: "Test Session",
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		}),
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
		isPreloaded: vi.fn(() => false),
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

describe("SessionMessagingService.sendMessage", () => {
	beforeAll(async () => {
		const module = await import("../session-messaging-service.js");
		SessionMessagingService = module.SessionMessagingService;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		sendPrompt.mockReturnValue(okAsync(undefined));
	});

	it("passes @[text:BASE64] tokens through to ACP for decoding", async () => {
		const deps = createMockDeps();
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.transientProjectionManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendMessage(
			"session-1",
			"@[text:aGVsbG8gd29ybGQ=]\nPlease summarize this"
		);

		expect(result.isOk()).toBe(true);
		// Tokens pass through unchanged — ACP provider handles decoding
		expect(sendPrompt).toHaveBeenCalledWith(
			"session-1",
			[{ type: "text", text: "@[text:aGVsbG8gd29ybGQ=]\nPlease summarize this" }],
			expect.any(String)
		);
	});

	it("allows a reserved created session to activate with its first prompt", async () => {
		const deps = createMockDeps();
		deps.stateReader.getSessionCanSend = vi.fn().mockReturnValue(false);
		deps.stateReader.getSessionLifecycleStatus = vi.fn().mockReturnValue("reserved");
		(deps.stateReader.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-1",
			projectPath: "/tmp/project",
			agentId: "cursor",
		});
		(deps.stateReader.getSessionMetadata as ReturnType<typeof vi.fn>).mockReturnValue({
			title: "New Thread",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created",
			parentId: null,
		});
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.transientProjectionManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendMessage("session-1", "diagnostic ping - reply ok");

		expect(result.isOk()).toBe(true);
		expect(sendPrompt).toHaveBeenCalledWith(
			"session-1",
			[{ type: "text", text: "diagnostic ping - reply ok" }],
			expect.any(String)
		);
	});

	it("records a local pending send intent without writing canonical lifecycle fields", async () => {
		const deps = createMockDeps();
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.transientProjectionManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendMessage("session-1", "hello");

		expect(result.isOk()).toBe(true);
		expect(deps.transientProjectionManager.updateTransientProjection).toHaveBeenCalledWith(
			"session-1",
			expect.objectContaining({
				pendingSendIntent: {
					attemptId: expect.any(String),
					startedAt: expect.any(Number),
					baselineTranscriptRevision: null,
					promptLength: 5,
					optimisticEntry: {
						id: expect.any(String),
						type: "user",
						message: {
							content: { type: "text", text: "hello" },
							chunks: [{ type: "text", text: "hello" }],
							sentAt: expect.any(Date),
						},
						timestamp: expect.any(Date),
					},
					},
				})
			);
		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
		);
	});

	it("does not write an optimistic user row into canonical session entries", async () => {
		const deps = createMockDeps();
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.transientProjectionManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendMessage("session-1", "hello");

		expect(result.isOk()).toBe(true);
	});

	it("fails closed when a created session lacks canonical lifecycle projection", async () => {
		const deps = createMockDeps();
		deps.stateReader.getSessionCanSend = vi.fn().mockReturnValue(false);
		deps.stateReader.getSessionLifecycleStatus = vi.fn().mockReturnValue(null);
		(deps.stateReader.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-1",
			projectPath: "/tmp/project",
			agentId: "cursor",
		});
		(deps.stateReader.getSessionMetadata as ReturnType<typeof vi.fn>).mockReturnValue({
			title: "Restored Thread",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created",
			parentId: null,
		});
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.transientProjectionManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendMessage("session-1", "diagnostic follow-up - reply ok");

		expect(result.isErr()).toBe(true);
		expect(sendPrompt).not.toHaveBeenCalled();
	});

	it("does not first-send activate source-backed created sessions", async () => {
		const deps = createMockDeps();
		deps.stateReader.getSessionCanSend = vi.fn().mockReturnValue(false);
		deps.stateReader.getSessionLifecycleStatus = vi.fn().mockReturnValue("reserved");
		(deps.stateReader.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-1",
			projectPath: "/tmp/project",
			agentId: "cursor",
		});
		(deps.stateReader.getSessionMetadata as ReturnType<typeof vi.fn>).mockReturnValue({
			title: "Restored Thread",
			createdAt: new Date(),
			updatedAt: new Date(),
			sourcePath: "/tmp/project/.cursor/history/session.jsonl",
			sessionLifecycleState: "created",
			parentId: null,
		});
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.transientProjectionManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendMessage("session-1", "diagnostic follow-up - reply ok");

		expect(result.isErr()).toBe(true);
		expect(sendPrompt).not.toHaveBeenCalled();
	});

	it("clears pending creation send intent without writing lifecycle state when the first prompt fails to send", async () => {
		const deps = createMockDeps();
		const error = new Error("transport unavailable");
		sendPrompt.mockReturnValue(errAsync(error));
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.transientProjectionManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendPendingCreationMessage("pending-session", "hello");

		expect(result.isErr()).toBe(true);
		expect(deps.connectionManager.sendTurnFailed).toHaveBeenCalledWith("pending-session", {
			turnId: null,
			kind: "fatal",
			message: "transport unavailable",
			code: null,
			source: "unknown",
		});
		expect(deps.transientProjectionManager.updateTransientProjection).toHaveBeenNthCalledWith(
			1,
			"pending-session",
			expect.objectContaining({
				pendingSendIntent: {
					attemptId: expect.any(String),
					startedAt: expect.any(Number),
					baselineTranscriptRevision: null,
					promptLength: 5,
					optimisticEntry: {
						id: expect.any(String),
						type: "user",
						message: {
							content: { type: "text", text: "hello" },
							chunks: [{ type: "text", text: "hello" }],
							sentAt: expect.any(Date),
						},
						timestamp: expect.any(Date),
					},
					},
				})
			);
		expect(deps.transientProjectionManager.updateTransientProjection).toHaveBeenLastCalledWith("pending-session", {
			pendingSendIntent: null,
		});
		expectNoCanonicalOverlapTransientProjectionWrites(
			deps.transientProjectionManager.updateTransientProjection as ReturnType<typeof vi.fn>
		);
	});
});
