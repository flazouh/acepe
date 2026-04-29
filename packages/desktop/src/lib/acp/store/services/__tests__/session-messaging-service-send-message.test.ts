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
		getHotState: vi.fn().mockReturnValue(DEFAULT_TRANSIENT_PROJECTION),
		getSessionCanSend: vi.fn().mockReturnValue(true),
		getSessionLifecycleStatus: vi.fn().mockReturnValue("ready"),
		getEntries: vi.fn().mockReturnValue([]),
		isPreloaded: vi.fn(),
		getSessionsForProject: vi.fn(),
		getSessionCold: vi.fn().mockReturnValue({
			id: "session-1",
			projectPath: "/tmp/project",
			agentId: "claude-code",
			title: "Test Session",
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		}),
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
			deps.hotStateManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendMessage(
			"session-1",
			"@[text:aGVsbG8gd29ybGQ=]\nPlease summarize this"
		);

		expect(result.isOk()).toBe(true);
		// Tokens pass through unchanged — ACP provider handles decoding
		expect(sendPrompt).toHaveBeenCalledWith("session-1", [
			{ type: "text", text: "@[text:aGVsbG8gd29ybGQ=]\nPlease summarize this" },
		]);
	});

	it("allows a reserved created session to activate with its first prompt", async () => {
		const deps = createMockDeps();
		deps.stateReader.getSessionCanSend = vi.fn().mockReturnValue(false);
		deps.stateReader.getSessionLifecycleStatus = vi.fn().mockReturnValue("reserved");
		(deps.stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-1",
			projectPath: "/tmp/project",
			agentId: "cursor",
			title: "New Thread",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created",
			parentId: null,
		});
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.hotStateManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendMessage("session-1", "diagnostic ping - reply ok");

		expect(result.isOk()).toBe(true);
		expect(sendPrompt).toHaveBeenCalledWith("session-1", [
			{ type: "text", text: "diagnostic ping - reply ok" },
		]);
	});

	it("records a local pending send intent without writing canonical lifecycle fields", async () => {
		const deps = createMockDeps();
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.hotStateManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendMessage("session-1", "hello");

		expect(result.isOk()).toBe(true);
		expect(deps.hotStateManager.updateHotState).toHaveBeenCalledWith("session-1", {
			pendingSendIntent: {
				attemptId: expect.any(String),
				startedAt: expect.any(Number),
				promptLength: 5,
			},
		});
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
	});

	it("fails closed when a created session lacks canonical lifecycle projection", async () => {
		const deps = createMockDeps();
		deps.stateReader.getSessionCanSend = vi.fn().mockReturnValue(false);
		(deps.stateReader.getEntries as ReturnType<typeof vi.fn>).mockReturnValue([
			{
				id: "assistant-1",
				type: "assistant",
				message: {
					content: {
						type: "text",
						text: "existing response",
					},
					chunks: [],
				},
				timestamp: new Date(),
			},
		]);
		deps.stateReader.getSessionLifecycleStatus = vi.fn().mockReturnValue(null);
		(deps.stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-1",
			projectPath: "/tmp/project",
			agentId: "cursor",
			title: "Restored Thread",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created",
			parentId: null,
		});
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.hotStateManager,
			deps.entryManager,
			deps.connectionManager
		);

		const result = await service.sendMessage("session-1", "diagnostic follow-up - reply ok");

		expect(result.isErr()).toBe(true);
		expect(sendPrompt).not.toHaveBeenCalled();
	});

	it("does not first-send activate source-backed created sessions", async () => {
		const deps = createMockDeps();
		(deps.stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(
			DEFAULT_TRANSIENT_PROJECTION
		);
		deps.stateReader.getSessionCanSend = vi.fn().mockReturnValue(false);
		deps.stateReader.getSessionLifecycleStatus = vi.fn().mockReturnValue("reserved");
		(deps.stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-1",
			projectPath: "/tmp/project",
			agentId: "cursor",
			title: "Restored Thread",
			createdAt: new Date(),
			updatedAt: new Date(),
			sourcePath: "/tmp/project/.cursor/history/session.jsonl",
			sessionLifecycleState: "created",
			parentId: null,
		});
		const service = new SessionMessagingService(
			deps.stateReader,
			deps.hotStateManager,
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
			deps.hotStateManager,
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
		expect(deps.hotStateManager.updateHotState).toHaveBeenCalledWith("pending-session", {
			pendingSendIntent: {
				attemptId: expect.any(String),
				startedAt: expect.any(Number),
				promptLength: 5,
			},
		});
		expect(deps.hotStateManager.updateHotState).toHaveBeenLastCalledWith("pending-session", {
			pendingSendIntent: null,
		});
		expectNoCanonicalOverlapHotStateWrites(
			deps.hotStateManager.updateHotState as ReturnType<typeof vi.fn>
		);
	});
});
