import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";

import type { SessionOpenFound } from "../../../../services/acp-types.js";
import type { SessionCold, SessionEntry } from "../../types.js";
import type {
	IConnectionManager,
	IEntryManager,
	ISessionStateReader,
	ISessionStateWriter,
} from "../interfaces/index.js";

function createSessionOpenFound(overrides: Partial<SessionOpenFound> = {}): SessionOpenFound {
	return {
		requestedSessionId: overrides.requestedSessionId ?? "session-1",
		canonicalSessionId: overrides.canonicalSessionId ?? "session-1",
		isAlias: overrides.isAlias ?? false,
		lastEventSeq: overrides.lastEventSeq ?? 2,
		openToken: overrides.openToken ?? "open-token",
		agentId: overrides.agentId ?? "copilot",
		projectPath: overrides.projectPath ?? "/projects/acepe",
		worktreePath: overrides.worktreePath ?? null,
		sourcePath: overrides.sourcePath ?? "/history/events.jsonl",
		transcriptSnapshot: overrides.transcriptSnapshot ?? {
			revision: overrides.lastEventSeq ?? 2,
			entries: [],
		},
		sessionTitle: overrides.sessionTitle ?? "History title",
		operations: overrides.operations ?? [],
		interactions: overrides.interactions ?? [],
		turnState: overrides.turnState ?? "Idle",
		messageCount: overrides.messageCount ?? 1,
	};
}

const getSessionOpenResultMock = mock(() =>
	okAsync({
		outcome: "found" as const,
		...createSessionOpenFound(),
	})
);

mock.module("../../api.js", () => ({
	api: {
		getSessionOpenResult: getSessionOpenResultMock,
	},
}));

import { SessionRepository } from "../session-repository.js";

type SessionStoreState = {
	sessions: SessionCold[];
};

function createHydratedEntries(): SessionEntry[] {
	return [
		{
			id: "user-1",
			type: "user",
			message: {
				content: { type: "text", text: "Ship it" },
				chunks: [{ type: "text", text: "Ship it" }],
			},
		},
	];
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
			state.sessions = state.sessions.concat([session]);
		},
		updateSession: (id, updates) => {
			state.sessions = state.sessions.map((session) => {
				if (session.id !== id) {
					return session;
				}

				return {
					id: session.id,
					projectPath: updates.projectPath ?? session.projectPath,
					agentId: updates.agentId ?? session.agentId,
					title: updates.title ?? session.title,
					updatedAt: updates.updatedAt ?? session.updatedAt,
					createdAt: updates.createdAt ?? session.createdAt,
					sourcePath: updates.sourcePath ?? session.sourcePath,
					parentId: updates.parentId ?? session.parentId,
					worktreePath: updates.worktreePath ?? session.worktreePath,
					worktreeDeleted: updates.worktreeDeleted ?? session.worktreeDeleted,
					prNumber: updates.prNumber ?? session.prNumber,
					sessionLifecycleState: updates.sessionLifecycleState ?? session.sessionLifecycleState,
					sequenceId: updates.sequenceId ?? session.sequenceId,
				};
			});
		},
		replaceSessionOpenSnapshot: (snapshot) => {
			const hydratedEntries = createHydratedEntries();
			entriesBySession.set(snapshot.canonicalSessionId, hydratedEntries);
			preloadedSessionIds.add(snapshot.canonicalSessionId);
			storedEntries.push(hydratedEntries);
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

const storedEntries: SessionEntry[][] = [];
const entriesBySession = new Map<string, SessionEntry[]>();
const preloadedSessionIds = new Set<string>();

const entryManager: IEntryManager = {
	getEntries: (sessionId) => entriesBySession.get(sessionId) ?? [],
	hasEntries: () => false,
	isPreloaded: (sessionId) => preloadedSessionIds.has(sessionId),
	markPreloaded: (sessionId) => {
		preloadedSessionIds.add(sessionId);
	},
	unmarkPreloaded: (sessionId) => {
		preloadedSessionIds.delete(sessionId);
	},
	storeEntriesAndBuildIndex: (sessionId, entries) => {
		entriesBySession.set(sessionId, entries);
		preloadedSessionIds.add(sessionId);
		storedEntries.push(entries);
	},
	addEntry: () => {},
	removeEntry: () => {},
	updateEntry: () => {},
	clearEntries: (sessionId) => {
		entriesBySession.delete(sessionId);
		preloadedSessionIds.delete(sessionId);
	},
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

describe("SessionRepository.preloadSessionDetails", () => {
	beforeEach(() => {
		getSessionOpenResultMock.mockReset();
		getSessionOpenResultMock.mockImplementation(() =>
			okAsync({
				outcome: "found" as const,
				...createSessionOpenFound(),
			})
		);
		storedEntries.length = 0;
		entriesBySession.clear();
		preloadedSessionIds.clear();
	});

	it("hydrates entries from canonical session-open snapshots", async () => {
		const state: SessionStoreState = { sessions: [] };
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		const result = await repository.preloadSessionDetails(
			"session-1",
			"/projects/acepe",
			"opencode"
		);

		expect(result.isOk()).toBe(true);
		expect(storedEntries).toHaveLength(1);
		expect(storedEntries[0]?.[0]?.type).toBe("user");
	});

	it("reuses preloaded entries when the requested sourcePath matches the cached source", async () => {
		const state: SessionStoreState = { sessions: [] };
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		const first = await repository.preloadSessionDetails(
			"session-1",
			"/projects/acepe",
			"copilot",
			"/history/events.jsonl"
		);
		const second = await repository.preloadSessionDetails(
			"session-1",
			"/projects/acepe",
			"copilot",
			"/history/events.jsonl"
		);

		expect(first.isOk()).toBe(true);
		expect(second.isOk()).toBe(true);
		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(1);
	});

	it("reloads a preloaded session when a sourcePath appears after an older preload", async () => {
		const state: SessionStoreState = { sessions: [] };
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		preloadedSessionIds.add("session-1");
		entriesBySession.set("session-1", [
			{
				id: "assistant-stale",
				type: "assistant",
				message: {
					chunks: [
						{
							type: "message",
							block: {
								type: "text",
								text: "Stale ACP replay content",
							},
						},
					],
					receivedAt: new Date("2026-04-08T00:00:00Z"),
				},
				timestamp: new Date("2026-04-08T00:00:00Z"),
			},
		]);

		const result = await repository.preloadSessionDetails(
			"session-1",
			"/projects/acepe",
			"copilot",
			"/history/events.jsonl"
		);

		expect(result.isOk()).toBe(true);
		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(1);
		expect(storedEntries).toHaveLength(1);
		expect(storedEntries[0]?.[0]?.type).toBe("user");
	});
});
