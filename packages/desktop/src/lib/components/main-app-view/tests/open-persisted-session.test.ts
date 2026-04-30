import { beforeEach, describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { ConnectionError } from "$lib/acp/errors/app-error.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { SessionOpenResult } from "$lib/services/acp-types.js";

const getSessionOpenResultMock = mock(() => okAsync(createFoundResult("session-1")));

let openPersistedSession: typeof import("../logic/open-persisted-session.js").openPersistedSession;
let resetOpenPersistedSessionForTests: typeof import("../logic/open-persisted-session.js").__resetOpenPersistedSessionForTests;

type SessionOpenStore = Pick<
	SessionStore,
	| "setSessionLoading"
	| "setSessionLoaded"
	| "setLocalCreatedSessionLoaded"
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
			setLocalCreatedSessionLoaded: mock(() => {}),
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
		getSessionOpenResultMock.mockImplementation(() =>
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
		getSessionOpenResultMock.mockImplementation(() =>
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

	it("hydrates the open snapshot before marking loaded and connecting for manual and startup opens", async () => {
		const sources = ["session-handler", "initialization-manager"] as const;

		for (const source of sources) {
			const sessionId = source === "session-handler" ? "manual-session" : "startup-session";
			const panelId = source === "session-handler" ? "manual-panel" : "startup-panel";
			const callOrder: string[] = [];

			sessionStore.setSessionLoading = mock((loadedSessionId: string) => {
				callOrder.push(`loading:${loadedSessionId}`);
			});
			sessionStore.setSessionLoaded = mock((loadedSessionId: string) => {
				callOrder.push(`loaded:${loadedSessionId}`);
			});
			const connectSession: SessionOpenStore["connectSession"] = (connectedSessionId: string) => {
				callOrder.push(`connect:${connectedSessionId}`);
				return okAsync({
					id: connectedSessionId,
					title: "Session",
					projectPath: "/project",
					agentId: "claude-code",
					createdAt: new Date(),
					updatedAt: new Date(),
					parentId: null,
				});
			};
			sessionStore.connectSession = mock(connectSession);
			sessionStore.getSessionCold = mock(() => ({
				id: sessionId,
				title: "Session",
				projectPath: "/project",
				agentId: "claude-code",
				sourcePath: `/tmp/${sessionId}.jsonl`,
				createdAt: new Date(),
				updatedAt: new Date(),
				parentId: null,
			}));
			sessionOpenHydrator.beginAttempt = mock(() => `request-${sessionId}`);
			sessionOpenHydrator.hydrateFound = mock(() => {
				callOrder.push(`hydrate:${sessionId}`);
				return okAsync({
					canonicalSessionId: sessionId,
					openToken: `open-token-${sessionId}`,
					applied: true,
				});
			});
			sessionOpenHydrator.clearAttempt = mock(() => {
				callOrder.push(`clear:${panelId}`);
			});
			sessionOpenHydrator.isCurrentAttempt = mock(() => true);
			getSessionOpenResultMock.mockImplementation(() => {
				callOrder.push(`open:${sessionId}`);
				return okAsync(createFoundResult(sessionId));
			});

			openPersistedSession({
				panelId,
				sessionId,
				sessionStore,
				sessionOpenHydrator,
				getSessionOpenResult: getSessionOpenResultMock,
				timeoutMs: 10_000,
				source,
			});

			await new Promise((resolve) => setTimeout(resolve, 0));
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(callOrder).toEqual([
				`loading:${sessionId}`,
				`open:${sessionId}`,
				`hydrate:${sessionId}`,
				`loaded:${sessionId}`,
				`clear:${panelId}`,
				`connect:${sessionId}`,
			]);
			resetOpenPersistedSessionForTests();
		}
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
		sessionStore.connectSession = mock(
			() =>
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

	it("surfaces an explicit non-openable result without connecting when the result is missing", async () => {
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
		// GOD: canonical lifecycle envelope (SessionGoneUpstream) drives UI;
		// open-persisted-session just unwinds local in-flight bookkeeping.
		expect(sessionOpenHydrator.clearAttempt).toHaveBeenCalledWith("panel-1");
		expect(sessionStore.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connectSession).not.toHaveBeenCalled();
	});

	it("falls back to local reattach when Rust cannot open a local-created snapshot", async () => {
		getSessionOpenResultMock.mockImplementation(
			() =>
				okAsync({
					outcome: "missing",
					requestedSessionId: "session-1",
				} as SessionOpenResult) as unknown as ReturnType<typeof getSessionOpenResultMock>
		);
		sessionStore.getSessionCold = mock(() => ({
			id: "session-1",
			title: "Session 1",
			projectPath: "/project",
			agentId: "cursor",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created" as const,
			parentId: null,
		}));

		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "initialization-manager",
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(1);
		expect(sessionOpenHydrator.clearAttempt).toHaveBeenCalledWith("panel-1");
		expect(sessionStore.setSessionLoading).toHaveBeenCalledWith("session-1");
		expect(sessionStore.setLocalCreatedSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.setSessionLoaded).not.toHaveBeenCalled();
		expect(sessionStore.connectSession).toHaveBeenCalledWith("session-1");
	});

	it("falls back to local reattach when local-created snapshot open rejects", async () => {
		getSessionOpenResultMock.mockImplementation(
			() =>
				errAsync(new Error("open snapshot unavailable")) as unknown as ReturnType<
					typeof getSessionOpenResultMock
				>
		);
		sessionStore.getSessionCold = mock(() => ({
			id: "session-1",
			title: "Session 1",
			projectPath: "/project",
			agentId: "cursor",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created" as const,
			parentId: null,
		}));

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
		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(1);
		expect(sessionStore.setSessionLoading).toHaveBeenCalledWith("session-1");
		expect(sessionStore.setLocalCreatedSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.setSessionLoaded).not.toHaveBeenCalled();
		expect(sessionStore.connectSession).toHaveBeenCalledWith("session-1");
	});

	it("hydrates local-created sessions when Rust can open a canonical snapshot", async () => {
		sessionStore.getSessionCold = mock(() => ({
			id: "session-1",
			title: "Session 1",
			projectPath: "/project",
			agentId: "cursor",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created" as const,
			parentId: null,
		}));

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
		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(1);
		expect(sessionOpenHydrator.hydrateFound).toHaveBeenCalledTimes(1);
		expect(sessionStore.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connectSession).toHaveBeenCalledWith("session-1", {
			openToken: "open-token-1",
		});
		expect(sessionStore.setLocalCreatedSessionLoaded).not.toHaveBeenCalled();
	});

	it("does not synthesize TS-side reattach failure messages when local-created reattach fails", async () => {
		// GOD: failure surfaces via canonical lifecycle envelope
		// (FailureReason::SessionGoneUpstream / ResumeFailed). The TS-side
		// string-match gate and friendly-message fallback have been retired —
		// open-persisted-session must not write any UI state on reattach failure
		// other than logging.
		getSessionOpenResultMock.mockImplementation(
			() =>
				okAsync({
					outcome: "missing",
					requestedSessionId: "session-1",
				} as SessionOpenResult) as unknown as ReturnType<typeof getSessionOpenResultMock>
		);
		sessionStore.getSessionCold = mock(() => ({
			id: "session-1",
			title: "Session 1",
			projectPath: "/project",
			agentId: "cursor",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created" as const,
			parentId: null,
		}));
		sessionStore.connectSession = mock(() =>
			errAsync(
				new ConnectionError(
					"session-1",
					new Error("Resource not found: Session session-1")
				)
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

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(1);
		expect(sessionStore.connectSession).toHaveBeenCalledWith("session-1");
		expect(sessionStore.setLocalCreatedSessionLoaded).not.toHaveBeenCalled();
		expect(sessionStore.setSessionLoaded).toHaveBeenCalledWith("session-1");
		// Must NOT carry symbols of the deleted gate.
		expect((sessionStore as unknown as Record<string, unknown>)["setSessionOpenMissing"]).toBeUndefined();
		expect(
			(sessionStore as unknown as Record<string, unknown>)["setLocalPersistedSessionProbeStatus"]
		).toBeUndefined();
	});

	it("surfaces provider parse failures via canonical lifecycle without connecting", async () => {
		// GOD: Rust emits ConnectionFailed envelope for parseFailure; UI is
		// canonical-driven. open-persisted-session must not synthesize copy.
		getSessionOpenResultMock.mockImplementation(
			() =>
				okAsync({
					outcome: "error",
					requestedSessionId: "session-1",
					message: "Claude provider history parse failed: invalid JSON",
					reason: "parseFailure",
					retryable: false,
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
		expect(sessionStore.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connectSession).not.toHaveBeenCalled();
	});

	it("surfaces retryable internal errors via canonical lifecycle without connecting", async () => {
		// GOD: Rust emits ConnectionFailed envelope (ResumeFailed for retryable);
		// UI reads lifecycle.failureReason. No TS-side copy synthesis here.
		getSessionOpenResultMock.mockImplementation(
			() =>
				okAsync({
					outcome: "error",
					requestedSessionId: "session-1",
					message: "database is locked while loading session-1",
					reason: "internal",
					retryable: true,
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
		expect(sessionStore.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connectSession).not.toHaveBeenCalled();
	});

	it("does not synthesize Cursor-specific copy for legacy store.db history sessions", async () => {
		// GOD: agent-specific copy lives in TS failure-copy mapper (Unit 5),
		// keyed on (agentId, lifecycle.failureReason) — never synthesized here.
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
		expect(sessionOpenHydrator.clearAttempt).toHaveBeenCalledWith("panel-1");
		expect(sessionStore.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connectSession).not.toHaveBeenCalled();
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
		lifecycle: {
			status: "ready",
			actionability: {
				canSend: true,
				canResume: false,
				canRetry: false,
				canArchive: false,
				canConfigure: true,
				recommendedAction: "send",
				recoveryPhase: "none",
				compactStatus: "ready",
			},
		},
		capabilities: {},
		...overrides,
	};
}
