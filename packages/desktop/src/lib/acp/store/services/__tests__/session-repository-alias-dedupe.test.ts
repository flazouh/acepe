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
	canonicalProjectionSessionIds?: Set<string>;
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
		getSessionAcpSessionId: () => null,
		getSessionAutonomousTransitionBusy: () => false,
		getSessionCanSend: () => null,
		getSessionLifecycleStatus: () => null,
		getSessionTurnState: () => null,
		getSessionLastTerminalTurnId: () => null,
		getGraphTranscriptRevision: () => undefined,
		getSessionAutonomousEnabled: () => null,
		getSessionCurrentModeId: () => null,
		getSessionAvailableModels: () => [],
		getSessionAvailableModes: () => [],
		getSessionToolCalls: () => [],
		getSessionModifiedFilesState: () => null,
		hasSessionCanonicalProjection: (sessionId: string) =>
			state.canonicalProjectionSessionIds?.has(sessionId) ?? false,
		getSessionCold: (id: string) => state.sessions.find((session) => session.id === id),
		getSessionIdentity: (id: string) => {
			const session = state.sessions.find((candidate) => candidate.id === id);
			if (!session) return undefined;
			return {
				id: session.id,
				projectPath: session.projectPath,
				agentId: session.agentId,
				worktreePath: session.worktreePath,
			};
		},
		getSessionMetadata: (id: string) => {
			const session = state.sessions.find((candidate) => candidate.id === id);
			if (!session) return undefined;
			return {
				title: session.title,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
				sourcePath: session.sourcePath,
				parentId: session.parentId,
				sequenceId: session.sequenceId,
			};
		},
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
	isPreloaded: () => false,
	clearEntries: () => {},
	finalizeStreamingEntries: () => {},
};

const connectionManager: IConnectionManager = {
	createOrGetMachine: () => {
		throw new Error("Not implemented for test");
	},
	getMachine: () => null,
	isResponseInProgress: () => false,
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

describe("SessionRepository alias dedupe on scan", () => {
	it("upgrades the orchestration-id row to the scanned provider identity instead of adding a twin", () => {
		const state: SessionStoreState = {
			sessions: [
				createSession({
					id: "session-orch-1",
					agentId: "claude-code",
					title: "Reply with exactly: ALIAS_43",
					sessionLifecycleState: "created",
					sourcePath: undefined,
				}),
			],
		};
		const repository = new SessionRepository(
			createStateReader(state),
			createStateWriter(state),
			entryManager,
			connectionManager
		);
		repository.noteProviderSessionAliases(new Map([["provider-uuid-1", "session-orch-1"]]));

		repository.refreshSessionsFromScan(
			state.sessions,
			[
				createHistoryEntry({
					id: "provider-uuid-1",
					sessionId: "provider-uuid-1",
					display: "Reply with exactly: ALIAS_43",
					project: "/projects/acepe",
					agentId: "claude-code",
					sourcePath: "/home/user/.claude/projects/x/provider-uuid-1.jsonl",
				}),
			],
			["/projects/acepe"]
		);

		const ids = state.sessions.map((session) => session.id);
		expect(ids).toEqual(["provider-uuid-1"]);
		expect(state.sessions[0]?.sourcePath).toBe(
			"/home/user/.claude/projects/x/provider-uuid-1.jsonl"
		);
		expect(state.sessions[0]?.title).toBe("Reply with exactly: ALIAS_43");
	});
});
