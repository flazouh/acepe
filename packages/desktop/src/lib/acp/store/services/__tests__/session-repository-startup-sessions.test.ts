import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";
import type {
	HistoryEntry,
	StartupSessionsResponse,
} from "../../../../services/claude-history-types.js";
import type { SessionCold } from "../../types.js";
import type {
	IConnectionManager,
	IEntryManager,
	ISessionStateReader,
	ISessionStateWriter,
} from "../interfaces/index.js";

const getStartupSessionsMock = mock(() =>
	okAsync({ entries: [], aliasRemaps: {} } as StartupSessionsResponse)
);

mock.module("../../api.js", () => ({
	api: {
		getStartupSessions: getStartupSessionsMock,
	},
}));

import { SessionRepository } from "../session-repository.js";

type SessionStoreState = {
	sessions: SessionCold[];
};

function createSession(overrides: Partial<SessionCold> = {}): SessionCold {
	return {
		id: "session-123",
		projectPath: "/projects/acepe",
		agentId: "opencode",
		title: "OpenCode Session",
		updatedAt: new Date(1000),
		createdAt: new Date(500),
		sourcePath: undefined,
		parentId: null,
		...overrides,
	};
}

function createHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		id: "history-123",
		sessionId: "session-123",
		display: "OpenCode Session",
		project: "/projects/acepe",
		timestamp: 1000,
		updatedAt: 2000,
		pastedContents: {},
		agentId: "opencode",
		sourcePath: "/opencode/storage/session/session-123.json",
		prNumber: null,
		...overrides,
	};
}

function createStateReader(state: SessionStoreState): ISessionStateReader {
	return {
		getHotState: () => ({
			status: "idle",
			isConnected: false,
			turnState: "idle" as const,
			acpSessionId: null,
			connectionError: null,
			autonomousEnabled: false,
			autonomousTransition: "idle",
			currentModel: null,
			currentMode: null,
			availableCommands: [],
			statusChangedAt: Date.now(),
		}),
		getEntries: () => [],
		isPreloaded: () => false,
		getSessionsForProject: () => [],
		getSessionCold: (id: string) => state.sessions.find((session) => session.id === id),
		getAllSessions: () => state.sessions,
	};
}

function createStateWriter(state: SessionStoreState): ISessionStateWriter {
	return {
		addSession: (session) => {
			state.sessions = [...state.sessions, session];
		},
		updateSession: (id, updates) => {
			state.sessions = state.sessions.map((session) =>
				session.id === id ? { ...session, ...updates } : session
			);
		},
		removeSession: (sessionId) => {
			state.sessions = state.sessions.filter((session) => session.id !== sessionId);
		},
		setSessions: (sessions) => {
			state.sessions = sessions;
		},
		setLoading: () => {},
		addScanningProjects: () => {},
		removeScanningProjects: () => {},
	};
}

const entryManager: IEntryManager = {
	getEntries: () => [],
	hasEntries: () => false,
	isPreloaded: () => false,
	markPreloaded: () => {},
	unmarkPreloaded: () => {},
	storeEntriesAndBuildIndex: () => {},
	addEntry: () => {},
	removeEntry: () => {},
	updateEntry: () => {},
	clearEntries: () => {},
	createToolCallEntry: () => {},
	updateToolCallEntry: () => {},
	aggregateAssistantChunk: () => {
		throw new Error("Not implemented for test");
	},
	clearStreamingAssistantEntry: () => {},
	finalizeStreamingEntries: () => {},
};

const connectionManager: IConnectionManager = {
	createOrGetMachine: () => {
		throw new Error("Not implemented for test");
	},
	getMachine: () => null,
	getState: () => null,
	removeMachine: () => {},
	isConnecting: () => false,
	setConnecting: () => {},
	sendContentLoad: () => {},
	sendContentLoaded: () => {},
	sendContentLoadError: () => {},
	sendConnectionConnect: () => {},
	sendConnectionSuccess: () => {},
	sendCapabilitiesLoaded: () => {},
	sendConnectionError: () => {},
	sendTurnFailed: () => {},
	sendDisconnect: () => {},
	sendMessageSent: () => {},
	sendResponseStarted: () => {},
	sendResponseComplete: () => {},
	initializeConnectedSession: () => {},
};

describe("SessionRepository.loadStartupSessions", () => {
	beforeEach(() => {
		getStartupSessionsMock.mockClear();
		getStartupSessionsMock.mockImplementation(() =>
			okAsync({ entries: [], aliasRemaps: {} } as StartupSessionsResponse)
		);
	});

	it("hydrates requested startup session metadata and reports missing ids", async () => {
		const state: SessionStoreState = { sessions: [] };
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		getStartupSessionsMock.mockImplementation(() =>
			okAsync({ entries: [createHistoryEntry()], aliasRemaps: {} })
		);

		const result = await repository.loadStartupSessions(state.sessions, [
			"session-123",
			"missing-session",
		]);

		expect(getStartupSessionsMock).toHaveBeenCalledWith(["session-123", "missing-session"]);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.missing).toEqual(["missing-session"]);
		}
		expect(state.sessions[0]?.id).toBe("session-123");
		expect(state.sessions[0]?.projectPath).toBe("/projects/acepe");
		expect(state.sessions[0]?.sourcePath).toBe("/opencode/storage/session/session-123.json");
	});

	it("skips fetching startup session metadata already loaded in memory", async () => {
		const state: SessionStoreState = {
			sessions: [createSession()],
		};
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		const result = await repository.loadStartupSessions(state.sessions, ["session-123"]);

		expect(getStartupSessionsMock).not.toHaveBeenCalled();
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.missing).toEqual([]);
		}
		expect(state.sessions).toHaveLength(1);
	});

	it("returns alias remaps when sessions are matched by provider_session_id", async () => {
		const state: SessionStoreState = { sessions: [] };
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		// Backend returns the session under its canonical ID, with an alias remap
		getStartupSessionsMock.mockImplementation(() =>
			okAsync({
				entries: [
					createHistoryEntry({
						id: "acepe-uuid",
						sessionId: "acepe-uuid",
					}),
				],
				aliasRemaps: { "claude-session": "acepe-uuid" },
			})
		);

		const result = await repository.loadStartupSessions(state.sessions, ["claude-session"]);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			// The alias should not be reported as missing
			expect(result.value.missing).toEqual([]);
			// The alias remap should be passed through
			expect(result.value.aliasRemaps).toEqual({ "claude-session": "acepe-uuid" });
		}
		// Session is stored under its canonical ID
		expect(state.sessions[0]?.id).toBe("acepe-uuid");
	});

	it("preserves optional metadata when alias reconciliation remaps to a canonical id", () => {
		const aliasSession = createSession({
			id: "claude-session",
			title: "Loading...",
			sourcePath: "/tmp/alias.jsonl",
			worktreePath: "/repo/.worktrees/feature-a",
			worktreeDeleted: true,
			prNumber: 129,
			prState: "OPEN",
			parentId: "stale-parent",
			sequenceId: 42,
		});
		const repository = new SessionRepository(
			createStateReader({ sessions: [] }),
			createStateWriter({ sessions: [] }),
			entryManager,
			connectionManager
		);
		const reconcileAliasedStartupSessions = (
			repository as unknown as {
				reconcileAliasedStartupSessions: (
					mergedSessions: SessionCold[],
					existingSessions: SessionCold[],
					aliasRemaps: Record<string, string>
				) => SessionCold[];
			}
		).reconcileAliasedStartupSessions.bind(repository);

		const reconciled = reconcileAliasedStartupSessions(
			[
				createSession({
					id: "acepe-uuid",
					title: "Canonical Session",
					sourcePath: undefined,
					worktreePath: undefined,
					worktreeDeleted: undefined,
					prNumber: undefined,
					prState: undefined,
					sequenceId: undefined,
				}),
				aliasSession,
			],
			[aliasSession],
			{ "claude-session": "acepe-uuid" }
		);

		expect(reconciled).toHaveLength(1);
		expect(reconciled[0]?.id).toBe("acepe-uuid");
		expect(reconciled[0]?.title).toBe("Canonical Session");
		expect(reconciled[0]?.sourcePath).toBe("/tmp/alias.jsonl");
		expect(reconciled[0]?.worktreePath).toBe("/repo/.worktrees/feature-a");
		expect(reconciled[0]?.worktreeDeleted).toBe(true);
		expect(reconciled[0]?.prNumber).toBe(129);
		expect(reconciled[0]?.prState).toBe("OPEN");
		expect(reconciled[0]?.parentId).toBeNull();
		expect(reconciled[0]?.sequenceId).toBe(42);
	});

	it("returns empty alias remaps when all sessions match by canonical id", async () => {
		const state: SessionStoreState = { sessions: [] };
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		getStartupSessionsMock.mockImplementation(() =>
			okAsync({
				entries: [createHistoryEntry()],
				aliasRemaps: {},
			})
		);

		const result = await repository.loadStartupSessions(state.sessions, ["session-123"]);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.aliasRemaps).toEqual({});
		}
	});
});
