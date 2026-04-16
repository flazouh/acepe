import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionOpenFound } from "$lib/services/acp-types.js";
import type { HistoryEntry } from "$lib/services/claude-history-types.js";
import type { ConvertedSession } from "$lib/services/converted-session-types.js";

// Mock the api module
vi.mock("../api.js", () => ({
	api: {
		getSession: vi.fn(),
		scanSessions: vi.fn(),
		sendPrompt: vi.fn(),
	},
}));

import { api } from "../api.js";
import { SessionStore } from "../session-store.svelte.js";

const defaultStats: ConvertedSession["stats"] = {
	total_messages: 0,
	user_messages: 0,
	assistant_messages: 0,
	tool_uses: 0,
	tool_results: 0,
	thinking_blocks: 0,
	total_input_tokens: 0,
	total_output_tokens: 0,
};

/** Minimal session for tests. */
function mockSession(
	overrides: Partial<ConvertedSession> & { entries?: ConvertedSession["entries"] } = {}
): ConvertedSession {
	return {
		title: "Session Title",
		entries: overrides.entries ?? [],
		stats: overrides.stats ?? defaultStats,
		createdAt: overrides.createdAt ?? new Date().toISOString(),
		...overrides,
	};
}

/** Single history entry for scan mocks. */
function mockHistoryEntry(overrides: Partial<HistoryEntry>): HistoryEntry {
	return {
		id: "session-1",
		display: "Display",
		timestamp: Date.now(),
		project: "/project",
		sessionId: "session-1",
		agentId: "cursor",
		updatedAt: Date.now(),
		...overrides,
	};
}

function mockSessionOpenFound(
	overrides: Partial<SessionOpenFound> = {}
): SessionOpenFound {
	return {
		requestedSessionId: overrides.requestedSessionId ?? "requested-session",
		canonicalSessionId: overrides.canonicalSessionId ?? "canonical-session",
		isAlias: overrides.isAlias ?? false,
		lastEventSeq: overrides.lastEventSeq ?? 0,
		openToken: overrides.openToken ?? "open-token",
		agentId: overrides.agentId ?? "claude-code",
		projectPath: overrides.projectPath ?? "/project",
		worktreePath: overrides.worktreePath ?? null,
		sourcePath: overrides.sourcePath ?? null,
		threadEntries: overrides.threadEntries ?? [],
		sessionTitle: overrides.sessionTitle ?? "Hydrated title",
		operations: overrides.operations ?? [],
		interactions: overrides.interactions ?? [],
		turnState: overrides.turnState ?? "Idle",
		messageCount: overrides.messageCount ?? 0,
	};
}

describe("SessionStore loadSessionById title update", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
		vi.clearAllMocks();
	});

	it("updates session title from 'Loading...' to actual title after load", async () => {
		// Arrange: Mock API to return a session with a real title
		const session = mockSession({ title: "My Actual Session Title" });
		vi.mocked(api.getSession).mockReturnValue(okAsync(session));

		// Act: Load the session
		const result = await store.loadSessionById("session-123", "/test/path", "claude-code").match(
			(session) => session,
			(error) => {
				throw error;
			}
		);

		// Assert: Session title should be the actual title, not "Loading..."
		expect(result.title).toBe("My Actual Session Title");

		// Also verify via getSession
		const storedSession = store.getSessionCold("session-123");
		expect(storedSession?.title).toBe("My Actual Session Title");
	});

	it("hydrates current mode from canonical session load data", async () => {
		const session = {
			...mockSession({ title: "Plan Session" }),
			currentModeId: "plan",
		} as ConvertedSession;
		vi.mocked(api.getSession).mockReturnValue(okAsync(session));

		await store.loadSessionById("session-123", "/test/path", "claude-code").match(
			(loadedSession) => loadedSession,
			(error) => {
				throw error;
			}
		);

		const hotState = store.getHotState("session-123");
		expect(hotState.currentMode?.id).toBe("plan");
		expect(hotState.currentMode?.name).toBe("Plan");
	});

	it("uses fallback title when API returns no title", async () => {
		// Arrange: Mock API returning session without title (e.g. legacy backend)
		const session = mockSession({ title: "", entries: [] });
		const response = { ...session, title: undefined } as unknown as ConvertedSession;
		vi.mocked(api.getSession).mockReturnValue(okAsync(response));

		// Act: Load the session
		await store.loadSessionById("session-123", "/test/path", "claude-code");

		// Assert: Session should use fallback title, not "Loading..."
		const storedSession = store.getSessionCold("session-123");
		expect(storedSession?.title).toBe("New Thread");
	});

	it("uses fallback title when API returns empty string title", async () => {
		// Arrange: Mock API to return a session with empty title
		const mockSession = {
			title: "",
			entries: [],
			stats: {
				total_messages: 0,
				user_messages: 0,
				assistant_messages: 0,
				tool_uses: 0,
				tool_results: 0,
				thinking_blocks: 0,
				total_input_tokens: 0,
				total_output_tokens: 0,
			},
			createdAt: new Date().toISOString(),
		};
		vi.mocked(api.getSession).mockReturnValue(okAsync(mockSession));

		// Act: Load the session
		await store.loadSessionById("session-123", "/test/path", "claude-code");

		// Assert: Session should use fallback title (empty string is falsy)
		const storedSession = store.getSessionCold("session-123");
		expect(storedSession?.title).toBe("New Thread");
	});

	it("preserves scanner title when converter returns empty title", async () => {
		// This is the OpenCode bug regression test:
		// 1. Scanner already set a good title from disk metadata
		// 2. loadSessionById calls converter which returns empty title
		// 3. The existing good title should be preserved, NOT overwritten

		// Arrange: Simulate scanner having already added a session with a good title
		store.addSession({
			id: "session-oc",
			projectPath: "/project",
			agentId: "opencode",
			title: "Good Title From Scanner",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		});

		// Mock converter returning empty title (OpenCode fallback scenario)
		vi.mocked(api.getSession).mockReturnValue(
			okAsync({
				title: "",
				entries: [],
				stats: {
					total_messages: 0,
					user_messages: 0,
					assistant_messages: 0,
					tool_uses: 0,
					tool_results: 0,
					thinking_blocks: 0,
					total_input_tokens: 0,
					total_output_tokens: 0,
				},
				createdAt: new Date().toISOString(),
			})
		);

		await store.loadSessionById("session-oc", "/project", "opencode");

		// The good scanner title should be preserved
		expect(store.getSessionCold("session-oc")?.title).toBe("Good Title From Scanner");
	});

	it("uses converter title over scanner title when converter returns meaningful title", async () => {
		// Scanner set a title, but converter returns a better one
		store.addSession({
			id: "session-oc2",
			projectPath: "/project",
			agentId: "opencode",
			title: "Scanner Title",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		});

		vi.mocked(api.getSession).mockReturnValue(
			okAsync({
				title: "Better Title From Converter",
				entries: [],
				stats: {
					total_messages: 0,
					user_messages: 0,
					assistant_messages: 0,
					tool_uses: 0,
					tool_results: 0,
					thinking_blocks: 0,
					total_input_tokens: 0,
					total_output_tokens: 0,
				},
				createdAt: new Date().toISOString(),
			})
		);

		await store.loadSessionById("session-oc2", "/project", "opencode");

		// Converter title should win since it's meaningful
		expect(store.getSessionCold("session-oc2")?.title).toBe("Better Title From Converter");
	});

	it("reconciles alias sessions onto the canonical session id during snapshot replacement", () => {
		const createdAt = new Date("2026-04-01T00:00:00.000Z");
		const updatedAt = new Date("2026-04-02T00:00:00.000Z");
		store.addSession({
			id: "provider-session",
			projectPath: "/project",
			agentId: "claude-code",
			title: "Alias title",
			updatedAt,
			createdAt,
			parentId: "parent-1",
		});

		store.replaceSessionOpenSnapshot(
			mockSessionOpenFound({
				requestedSessionId: "provider-session",
				canonicalSessionId: "canonical-session",
				isAlias: true,
				sessionTitle: "Canonical title",
			})
		);

		expect(store.getSessionCold("provider-session")).toBeUndefined();
		expect(store.getSessionCold("canonical-session")).toMatchObject({
			id: "canonical-session",
			title: "Canonical title",
			parentId: "parent-1",
			projectPath: "/project",
			agentId: "claude-code",
		});
		expect(store.getSessionCold("canonical-session")?.createdAt).toEqual(createdAt);
		expect(store.getSessionCold("canonical-session")?.updatedAt).toEqual(updatedAt);
	});

	it("loads codex sessions from disk and applies returned title", async () => {
		vi.mocked(api.getSession).mockReturnValue(
			okAsync({
				title: "Codex Loaded From Disk",
				entries: [],
				stats: {
					total_messages: 0,
					user_messages: 0,
					assistant_messages: 0,
					tool_uses: 0,
					tool_results: 0,
					thinking_blocks: 0,
					total_input_tokens: 0,
					total_output_tokens: 0,
				},
				createdAt: new Date().toISOString(),
			})
		);

		await store.loadSessionById("session-codex", "/test/path", "codex");

		expect(api.getSession).toHaveBeenCalledWith("session-codex", "/test/path", "codex", undefined);
		expect(store.getSessionCold("session-codex")?.title).toBe("Codex Loaded From Disk");
	});
});

describe("SessionStore loadSessions preserves existing loaded state", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
		vi.clearAllMocks();
	});

	it("preserves existing session title when loadSessions runs after loadSessionById", async () => {
		// This tests the race condition:
		// 1. loadSessionById creates placeholder with "Loading..."
		// 2. loadSessionById completes and updates title to "Real Title"
		// 3. loadSessions runs with history entries (which may have a different title or no title)
		// We expect the title from loadSessionById to be preserved

		// Arrange: First load a session via loadSessionById
		const mockSessionDetails = {
			title: "Real Title From Content",
			entries: [],
			stats: {
				total_messages: 0,
				user_messages: 0,
				assistant_messages: 0,
				tool_uses: 0,
				tool_results: 0,
				thinking_blocks: 0,
				total_input_tokens: 0,
				total_output_tokens: 0,
			},
			createdAt: new Date().toISOString(),
		};
		vi.mocked(api.getSession).mockReturnValue(okAsync(mockSessionDetails));

		// Load session by ID first
		await store.loadSessionById("session-123", "/test/path", "cursor");

		// Verify title is set correctly
		let session = store.getSessionCold("session-123");
		expect(session?.title).toBe("Real Title From Content");

		// Arrange: Now mock scanSessions to return a history entry for the same session
		// (simulating what happens when loadSessions runs)
		const mockHistoryEntries: HistoryEntry[] = [
			mockHistoryEntry({
				id: "session-123",
				display: "History Display Title",
				project: "/test/path",
				sessionId: "session-123",
				agentId: "cursor",
			}),
		];
		vi.mocked(api.scanSessions).mockReturnValue(okAsync(mockHistoryEntries));

		// Act: Run loadSessions (simulating what happens during initialization)
		await store.loadSessions(["/test/path"]);

		// Assert: The title should be preserved from loadSessionById, NOT overwritten by history
		session = store.getSessionCold("session-123");
		expect(session?.title).toBe("Real Title From Content");
	});

	it("uses history title when session was not previously loaded", async () => {
		// When loadSessions runs and the session doesn't exist yet,
		// it should use the title from history

		// Arrange: Mock scanSessions with a session
		const mockHistoryEntries: HistoryEntry[] = [
			mockHistoryEntry({
				id: "session-456",
				display: "History Title",
				project: "/test/path",
				sessionId: "session-456",
				agentId: "cursor",
			}),
		];
		vi.mocked(api.scanSessions).mockReturnValue(okAsync(mockHistoryEntries));

		// Act: Run loadSessions
		await store.loadSessions(["/test/path"]);

		// Assert: The title should come from history
		const session = store.getSessionCold("session-456");
		expect(session?.title).toBe("History Title");
	});
});

describe("SessionStore title updates", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
		vi.clearAllMocks();
	});

	it("does not rescan project sessions when a stream completes", () => {
		store.addSession({
			id: "session-123",
			projectPath: "/test/path",
			agentId: "codex",
			title: "New Thread",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		});

		const scanSpy = vi.spyOn(store, "scanSessions").mockReturnValue(okAsync(undefined));

		store.handleStreamComplete("session-123");

		expect(scanSpy).not.toHaveBeenCalled();
	});

	it("updates fallback title from the first meaningful user message", async () => {
		store.addSession({
			id: "session-123",
			projectPath: "/test/path",
			agentId: "codex",
			title: "New Thread",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		});
		// Access internal hot state for test setup (SessionStore does not expose this)
		(
			store as unknown as {
				hotStateStore: {
					initializeHotState: (id: string, state: { isConnected: boolean; status: string }) => void;
				};
			}
		).hotStateStore.initializeHotState("session-123", {
			isConnected: true,
			status: "ready",
		});

		vi.mocked(api.sendPrompt).mockReturnValue(okAsync(undefined));

		await store.sendMessage("session-123", "Implement authentication flow").match(
			() => undefined,
			(error) => {
				throw error;
			}
		);

		expect(store.getSessionCold("session-123")?.title).toBe("Implement authentication flow");
	});

	it("updates session prNumber from streamed entries on turn completion", () => {
		store.addSession({
			id: "session-456",
			projectPath: "/test/path",
			agentId: "codex",
			title: "PR Session",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		});

		store.handleStreamEntry("session-456", {
			id: "assistant-1",
			type: "assistant",
			message: {
				chunks: [
					{
						type: "message",
						block: { type: "text", text: "Created https://github.com/acme/acepe/pull/321" },
					},
				],
			},
		});

		store.handleStreamComplete("session-456");

		expect(store.getSessionCold("session-456")?.prNumber).toBe(321);
	});
});
