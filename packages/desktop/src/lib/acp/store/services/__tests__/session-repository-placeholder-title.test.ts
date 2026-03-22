import { describe, expect, it } from "bun:test";
import type { HistoryEntry } from "../../../../services/claude-history-types.js";
import type { SessionEntry } from "../../types.js";
import type { SessionCold } from "../../types.js";
import type {
	IConnectionManager,
	IEntryManager,
	ISessionStateReader,
	ISessionStateWriter,
} from "../interfaces/index.js";

import { SessionRepository } from "../session-repository.js";

type SessionStoreState = {
	sessions: SessionCold[];
	preloadedSessionIds: Set<string>;
};

function createSession(overrides: Partial<SessionCold> = {}): SessionCold {
	return {
		id: "session-12345678",
		projectPath: "/projects/acepe",
		agentId: "opencode",
		title: "Session session-",
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
		sessionId: "session-12345678",
		display: "Real Restored Title",
		project: "/projects/acepe",
		timestamp: 500,
		updatedAt: 2000,
		pastedContents: {},
		agentId: "opencode",
		sourcePath: "/opencode/storage/session/session-12345678.json",
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
			currentModel: null,
			currentMode: null,
			availableCommands: [],
			statusChangedAt: Date.now(),
		}),
		getEntries: () => [],
		isPreloaded: (sessionId: string) => state.preloadedSessionIds.has(sessionId),
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

function createEntryManager(preloadedSessionIds: Set<string>): IEntryManager {
	const entries: SessionEntry[] = [
		{
			id: "user-1",
			type: "user",
			message: {
				content: { type: "text", text: "Real Restored Title" },
				chunks: [{ type: "text", text: "Real Restored Title" }],
			},
		},
	];
	return {
		getEntries: () => entries,
		hasEntries: () => false,
		isPreloaded: (sessionId: string) => preloadedSessionIds.has(sessionId),
		markPreloaded: () => {},
		unmarkPreloaded: () => {},
		storeEntriesAndBuildIndex: () => {},
		addEntry: () => {},
		removeEntry: () => {},
		updateEntry: () => {},
		clearEntries: () => {},
		createToolCallEntry: () => {},
		updateToolCallEntry: () => {},
		updateChildInParent: () => {},
		aggregateAssistantChunk: () => {
			throw new Error("Not implemented for test");
		},
		clearStreamingAssistantEntry: () => {},
	};
}

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

describe("SessionRepository merge placeholder titles", () => {
	it("uses the first parsed user message as the title on restart", () => {
		const state: SessionStoreState = {
			sessions: [createSession()],
			preloadedSessionIds: new Set(["session-12345678"]),
		};

		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			createEntryManager(state.preloadedSessionIds),
			connectionManager
		);

		const mergeHistoryWithExisting = (
			repository as unknown as {
				mergeHistoryWithExisting: (
					entries: HistoryEntry[],
					existingSessions: SessionCold[]
				) => SessionCold[];
			}
		).mergeHistoryWithExisting.bind(repository);

		const sessions = mergeHistoryWithExisting([createHistoryEntry()], state.sessions);

		expect(sessions[0]?.title).toBe("Real Restored Title");
	});
});
