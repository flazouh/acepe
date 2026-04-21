import { beforeEach, describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { SessionOpenResult } from "$lib/services/acp-types.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";

const getSessionOpenResultMock = mock(() => okAsync(createFoundResult("session-1")));

let openPersistedSession: typeof import("../logic/open-persisted-session.js").openPersistedSession;
let resetOpenPersistedSessionForTests: typeof import("../logic/open-persisted-session.js").__resetOpenPersistedSessionForTests;

type SessionOpenStore = Pick<
	SessionStore,
	| "setSessionLoading"
	| "setSessionLoaded"
	| "setSessionOpenMissing"
	| "getSessionCold"
	| "connectSession"
>;

type SessionOpenHydratorLike = Pick<
	SessionOpenHydrator,
	"beginAttempt" | "clearAttempt" | "hydrateFound" | "isCurrentAttempt"
>;

describe("openPersistedSession", () => {
	let sessionStore: SessionOpenStore;
	let sessionOpenHydrator: SessionOpenHydratorLike;

	beforeEach(async () => {
		({
			openPersistedSession,
			__resetOpenPersistedSessionForTests: resetOpenPersistedSessionForTests,
		} = await import(`../logic/open-persisted-session.js?test=${Date.now()}`));
		resetOpenPersistedSessionForTests();
		getSessionOpenResultMock.mockReset();
		getSessionOpenResultMock.mockImplementation(() => okAsync(createFoundResult("session-1")));

		sessionStore = {
			setSessionLoading: mock(() => {}),
			setSessionLoaded: mock(() => {}),
			setSessionOpenMissing: mock(() => {}),
			connectSession: mock(() => okAsync({} as any)),
			getSessionCold: mock(() => ({
				id: "session-1",
				title: "Session 1",
				projectPath: "/project",
				agentId: "claude-code",
				sourcePath: "/tmp/session-1.jsonl",
				createdAt: new Date(),
				updatedAt: new Date(),
				parentId: null,
			})),
		} as unknown as SessionOpenStore;

		sessionOpenHydrator = {
			beginAttempt: mock(() => "request-1"),
			clearAttempt: mock(() => {}),
			hydrateFound: mock(() =>
				okAsync({
					canonicalSessionId: "session-1",
					openToken: "open-token-1",
					applied: true,
				})
			),
			isCurrentAttempt: mock(() => true),
		};
	});

	it("dedupes concurrent calls for the same panel", async () => {
		getSessionOpenResultMock.mockImplementation(
			() =>
				ResultAsync.fromSafePromise(
					new Promise<SessionOpenResult>((resolve) => {
						setTimeout(() => resolve(createFoundResult("session-1")), 0);
					})
				)
		);

		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});
		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(sessionStore.setSessionLoaded).toHaveBeenCalledTimes(1);
	});

	it("dedupes concurrent calls for the same panel across initialization and session handlers", async () => {
		getSessionOpenResultMock.mockImplementation(
			() =>
				ResultAsync.fromSafePromise(
					new Promise<SessionOpenResult>((resolve) => {
						setTimeout(() => resolve(createFoundResult("session-1")), 0);
					})
				)
		);

		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "initialization-manager",
		});
		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(sessionStore.setSessionLoaded).toHaveBeenCalledTimes(1);
	});

	it("hydrates and settles snapshot-only after a found result", async () => {
		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sessionOpenHydrator.hydrateFound).toHaveBeenCalledWith(
			"panel-1",
			"request-1",
			expect.objectContaining({
				outcome: "found",
				canonicalSessionId: "session-1",
			})
		);
		expect(sessionStore.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionOpenHydrator.clearAttempt).toHaveBeenCalledWith("panel-1");
		expect(sessionStore.connectSession).toHaveBeenCalledWith("session-1", {
			openToken: "open-token-1",
		});
	});

	it("reconnects hydrated sessions even when the snapshot was already current", async () => {
		sessionOpenHydrator = {
			beginAttempt: mock(() => "request-1"),
			clearAttempt: mock(() => {}),
			hydrateFound: mock(() =>
				okAsync({
					canonicalSessionId: "session-1",
					openToken: "open-token-1",
					applied: false,
				})
			),
			isCurrentAttempt: mock(() => true),
		};

		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(sessionStore.connectSession).toHaveBeenCalledWith("session-1", {
			openToken: "open-token-1",
		});
	});

	it("swallows reconnect failures after hydration", async () => {
		sessionStore.connectSession = mock(() =>
			errAsync(new Error("resume failed")) as unknown as ReturnType<
				SessionOpenStore["connectSession"]
			>
		);

		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(sessionStore.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connectSession).toHaveBeenCalledWith("session-1", {
			openToken: "open-token-1",
		});
	});

	// ==========================================================================
	// U7 E2E proof: canonical open path invariants
	// ==========================================================================

	it("[E2E] openToken from found result is threaded verbatim into connectSession", async () => {
		// Core proof: the token must survive the open → hydrate → connect chain without
		// being dropped or replaced by any intermediate step.
		const specificToken = "token-abc-xyz-123";
		getSessionOpenResultMock.mockImplementation(() =>
			okAsync(createFoundResult("session-1", { openToken: specificToken }))
		);
		sessionOpenHydrator.hydrateFound = mock(() =>
			okAsync({ canonicalSessionId: "session-1", openToken: specificToken, applied: true })
		);

		openPersistedSession({
			panelId: "panel-e2e-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(sessionStore.connectSession).toHaveBeenCalledWith("session-1", {
			openToken: specificToken,
		});
	});

	it("[E2E] uses canonical session id for all store updates when hydration rewrites an alias", async () => {
		// When the backend returns a canonical id different from the requested id (alias),
		// ALL store updates must use the canonical id, not the alias.
		const requestedId = "alias-provider-session";
		const canonicalId = "acepe-canonical-uuid";

		sessionStore.getSessionCold = mock(() => ({
			id: requestedId,
			title: "Aliased session",
			projectPath: "/project",
			agentId: "claude-code",
			sourcePath: "/tmp/alias.jsonl",
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		}));
		getSessionOpenResultMock.mockImplementation(() =>
			okAsync(
				createFoundResult(requestedId, {
					canonicalSessionId: canonicalId,
					isAlias: true,
				})
			)
		);
		sessionOpenHydrator.hydrateFound = mock(() =>
			okAsync({ canonicalSessionId: canonicalId, openToken: "token-alias", applied: true })
		);

		openPersistedSession({
			panelId: "panel-e2e-2",
			sessionId: requestedId,
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(sessionStore.setSessionLoaded).toHaveBeenCalledWith(canonicalId);
		expect(sessionStore.connectSession).toHaveBeenCalledWith(canonicalId, expect.anything());
		expect(sessionStore.setSessionLoaded).not.toHaveBeenCalledWith(requestedId);
	});

	it("[E2E] does not call connectSession when the open attempt is superseded by a newer one", async () => {
		// If a panel is retargeted between the open result arriving and hydration completing,
		// isCurrentAttempt returns false and reconnect must be suppressed to avoid stale state.
		sessionOpenHydrator.isCurrentAttempt = mock(() => false);

		openPersistedSession({
			panelId: "panel-e2e-3",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(sessionStore.connectSession).not.toHaveBeenCalled();
		expect(sessionOpenHydrator.hydrateFound).toHaveBeenCalled();
	});

	it("surfaces an explicit non-openable error without connecting when the result is missing", async () => {
		getSessionOpenResultMock.mockImplementation(
			() =>
				okAsync({
					outcome: "missing",
					requestedSessionId: "session-1",
				} as SessionOpenResult) as unknown as ReturnType<typeof getSessionOpenResultMock>
		);

		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sessionOpenHydrator.clearAttempt).toHaveBeenCalledWith("panel-1");
		expect(sessionStore.setSessionOpenMissing).toHaveBeenCalledWith(
			"session-1",
			"This session can't be reopened because no canonical session state is available."
		);
		expect(sessionStore.connectSession).not.toHaveBeenCalled();
	});

	it("uses Cursor-specific copy for legacy store.db history sessions", async () => {
		sessionStore.getSessionCold = mock(() => ({
			id: "session-1",
			title: "Cursor Session",
			projectPath: "/project",
			agentId: "cursor",
			sourcePath: "/tmp/session-1.store.db",
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		}));
		getSessionOpenResultMock.mockImplementation(
			() =>
				okAsync({
					outcome: "missing",
					requestedSessionId: "session-1",
				} as SessionOpenResult) as unknown as ReturnType<typeof getSessionOpenResultMock>
		);

		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sessionStore.setSessionOpenMissing).toHaveBeenCalledWith(
			"session-1",
			"This Cursor history session is view-only and can't be reopened because no canonical resumable state was persisted."
		);
	});
});

function createFoundResult(
	sessionId: string,
	overrides?: Partial<Extract<SessionOpenResult, { outcome: "found" }>>
): SessionOpenResult {
	return {
		outcome: "found",
		requestedSessionId: sessionId,
		canonicalSessionId: sessionId,
		isAlias: false,
		openToken: "open-token-1",
		agentId: "claude-code",
		projectPath: "/project",
		worktreePath: null,
		sourcePath: "/tmp/session-1.jsonl",
		lastEventSeq: 1,
		graphRevision: 1,
		transcriptSnapshot: {
			revision: 1,
			entries: [],
		},
		messageCount: 0,
		sessionTitle: "Session 1",
		operations: [],
		interactions: [],
		turnState: "Idle",
		...overrides,
	};
}
