import { describe, expect, it } from "bun:test";
import type { HistoryEntry } from "../../../../services/claude-history-types.js";
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
};

function createSession(overrides: Partial<SessionCold> = {}): SessionCold {
	return {
		id: "session-123",
		projectPath: "/projects/acepe",
		agentId: "opencode",
		title: "OpenCode Session",
		updatedAt: new Date(),
		createdAt: new Date(),
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
		replaceSessionOpenSnapshot: () => {},
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

describe("SessionRepository.refreshSessionsFromScan", () => {
	it("updates sourcePath for existing sessions when scan provides it", () => {
		const state: SessionStoreState = {
			sessions: [createSession({ sourcePath: undefined })],
		};
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		repository.refreshSessionsFromScan(state.sessions, [createHistoryEntry()]);

		expect(state.sessions[0]?.sourcePath).toBe("/opencode/storage/session/session-123.json");
	});

	it("sets parentId from scanned history entry", () => {
		const state: SessionStoreState = { sessions: [] };
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		repository.refreshSessionsFromScan(state.sessions, [
			createHistoryEntry({ parentId: "parent-456" }),
		]);

		expect(state.sessions[0]?.parentId).toBe("parent-456");
	});

	it("sets prNumber from scanned history entry", () => {
		const state: SessionStoreState = { sessions: [] };
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		repository.refreshSessionsFromScan(state.sessions, [createHistoryEntry({ prNumber: 123 })]);

		expect(state.sessions[0]?.prNumber).toBe(123);
	});

	it("preserves existing prNumber when scanned entry has null prNumber", () => {
		const state: SessionStoreState = {
			sessions: [createSession({ prNumber: 456 })],
		};
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		repository.refreshSessionsFromScan(state.sessions, [createHistoryEntry({ prNumber: null })]);

		expect(state.sessions[0]?.prNumber).toBe(456);
	});

	it("removes persisted sessions that disappear from a rescanned project", () => {
		const state: SessionStoreState = {
			sessions: [createSession({ sessionLifecycleState: "persisted" })],
		};
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		repository.refreshSessionsFromScan(state.sessions, [], ["/projects/acepe"]);

		expect(state.sessions).toHaveLength(0);
	});

	it("preserves created sessions that disappear from a rescanned project", () => {
		const state: SessionStoreState = {
			sessions: [createSession({ sessionLifecycleState: "created" })],
		};
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);

		repository.refreshSessionsFromScan(state.sessions, [], ["/projects/acepe"]);

		expect(state.sessions).toHaveLength(1);
		expect(state.sessions[0]?.id).toBe("session-123");
	});
});
