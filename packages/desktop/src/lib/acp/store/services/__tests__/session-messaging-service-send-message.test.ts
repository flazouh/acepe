import { okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HOT_STATE } from "../../types.js";
import type { IConnectionManager } from "../interfaces/connection-manager.js";
import type { IEntryManager } from "../interfaces/entry-manager.js";
import type { IHotStateManager } from "../interfaces/hot-state-manager.js";
import type { ISessionStateReader } from "../interfaces/session-state-reader.js";

const sendPrompt = vi.fn();

vi.mock("../../checkpoint-store.svelte.js", () => ({
	checkpointStore: {
		createCheckpoint: vi.fn(),
	},
}));

vi.mock("../../api.js", () => ({
	api: {
		sendPrompt,
	},
}));

let SessionMessagingService: typeof import("../session-messaging-service.js").SessionMessagingService;

function createMockDeps() {
	const stateReader: ISessionStateReader = {
		getHotState: vi.fn().mockReturnValue({
			...DEFAULT_HOT_STATE,
			isConnected: true,
		}),
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

	const hotStateManager: IHotStateManager = {
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
		updateChildInParent: vi.fn(),
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
});
