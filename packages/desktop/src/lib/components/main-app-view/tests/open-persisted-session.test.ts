import { beforeEach, describe, expect, it, mock } from "bun:test";
import { errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { ConnectionError } from "$lib/acp/errors/app-error.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { SessionOpenResult } from "$lib/services/acp-types.js";
import type { OpenPersistedSessionDiagnosticEvent } from "../logic/open-persisted-session.js";

const getSessionOpenResultMock = mock((_sessionId?: string) =>
	okAsync(createFoundResult("session-1"))
);

let openPersistedSession: typeof import("../logic/open-persisted-session.js").openPersistedSession;
let resetOpenPersistedSessionForTests: typeof import("../logic/open-persisted-session.js").__resetOpenPersistedSessionForTests;
let setOpenPersistedSessionDiagnosticRecorder: typeof import("../logic/open-persisted-session.js").setOpenPersistedSessionDiagnosticRecorder;

type SessionOpenStore = Pick<
	SessionStore,
	"read" | "loading" | "connection" | "clearSessionEntries"
>;

type SessionOpenHydratorLike = Pick<
	SessionOpenHydrator,
	"beginAttempt" | "clearAttempt" | "hydrateFound" | "isCurrentAttempt"
> & {
	hydrateFoundNow?: SessionOpenHydrator["hydrateFoundNow"];
};

type ExistingSession = NonNullable<ReturnType<SessionOpenStore["read"]["getSessionCold"]>>;

interface TestSessionLookup {
	readonly id: string;
	readonly title: string | null;
	readonly projectPath: string;
	readonly agentId: string;
	readonly sourcePath?: string;
	readonly worktreePath?: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly parentId: string | null;
	readonly sessionLifecycleState?: "created" | "persisted";
}

function waitForTimerTurn(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

describe("openPersistedSession", () => {
	let sessionStore: SessionOpenStore;
	let sessionOpenHydrator: SessionOpenHydratorLike;

	function setSessionLookup(session: TestSessionLookup): void {
		sessionStore.read.getSessionCold = mock(() => session);
		sessionStore.read.getSessionIdentity = mock(() => ({
			id: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
			worktreePath: session.worktreePath,
		}));
		sessionStore.read.getSessionMetadata = mock(() => ({
			title: session.title,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			sourcePath: session.sourcePath,
			sessionLifecycleState: session.sessionLifecycleState,
			parentId: session.parentId,
		}));
	}

	beforeEach(async () => {
		({
			openPersistedSession,
			__resetOpenPersistedSessionForTests: resetOpenPersistedSessionForTests,
			setOpenPersistedSessionDiagnosticRecorder,
		} = await import(`../logic/open-persisted-session.js?test=${Date.now()}`));
		resetOpenPersistedSessionForTests();
		getSessionOpenResultMock.mockReset();
		getSessionOpenResultMock.mockImplementation(() => okAsync(createFoundResult("session-1")));

		sessionStore = {
			read: {
				getSessionCold: mock(() => null),
				getSessionIdentity: mock(() => undefined),
				getSessionMetadata: mock(() => undefined),
				getSessionLifecycleStatus: mock(() => "ready" as const),
				getSessionCanSend: mock(() => true),
			},
			loading: {
				setSessionLoading: mock(() => {}),
				setSessionLoaded: mock(() => {}),
				setLocalCreatedSessionLoaded: mock(() => {}),
			},
			connection: {
				connectSession: mock(() => okAsync({} as ExistingSession)),
			},
			clearSessionEntries: mock(() => {}),
		} as unknown as SessionOpenStore;
		setSessionLookup({
			id: "session-1",
			title: "Session 1",
			projectPath: "/project",
			agentId: "claude-code",
			sourcePath: "/tmp/session-1.jsonl",
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		});

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
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledTimes(1);
	});

	it("starts the new session when a panel switches during an older cold open", async () => {
		let currentSessionId = "session-1";
		sessionStore.read.getSessionIdentity = mock((sessionId: string) => ({
			id: sessionId,
			projectPath: "/project",
			agentId: "claude-code",
			worktreePath: undefined,
		}));
		sessionStore.read.getSessionMetadata = mock(() => ({
			title: "Session",
			createdAt: new Date(),
			updatedAt: new Date(),
			sourcePath: "/tmp/session.jsonl",
			sessionLifecycleState: "persisted" as const,
			parentId: null,
		}));
		getSessionOpenResultMock.mockImplementation((sessionId?: string) =>
			sessionId === "session-1"
				? ResultAsync.fromSafePromise(
						new Promise<SessionOpenResult>((resolve) => {
							setTimeout(() => resolve(createFoundResult("session-1")), 10);
						})
					)
				: okAsync(createFoundResult("session-2"))
		);
		const open = (sessionId: string) =>
			openPersistedSession({
				panelId: "panel-1",
				sessionId,
				sessionStore,
				sessionOpenHydrator,
				getSessionOpenResult: getSessionOpenResultMock,
				isPanelCurrent: (_panelId, targetSessionId) => targetSessionId === currentSessionId,
				timeoutMs: 10_000,
				source: "session-handler",
			});

		open("session-1");
		currentSessionId = "session-2";
		open("session-2");

		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(2);
		await new Promise((resolve) => setTimeout(resolve, 15));
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
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledTimes(1);
	});

	it("hydrates the snapshot before reconnecting with the open token", async () => {
		const callOrder: string[] = [];
		sessionOpenHydrator.hydrateFound = mock(() => {
			callOrder.push("hydrate");
			return okAsync({
				canonicalSessionId: "session-1",
				openToken: "open-token-1",
				applied: true,
			});
		});
		sessionStore.connection.connectSession = mock(() => {
			callOrder.push("reconnect");
			return okAsync({} as ExistingSession);
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

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sessionOpenHydrator.hydrateFound).toHaveBeenCalledWith(
			"panel-1",
			"request-1",
			expect.objectContaining({
				outcome: "found",
				canonicalSessionId: "session-1",
			})
		);
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionOpenHydrator.clearAttempt).toHaveBeenCalledWith("panel-1");
		expect(sessionStore.connection.connectSession).toHaveBeenCalledWith("session-1", {
			openToken: "open-token-1",
			forceReconnect: true,
		});
		expect(callOrder).toEqual(["hydrate", "reconnect"]);
	});

	it("awaits canonical transcript repair before hydrating and reconnecting", async () => {
		const awaitSessionOpenRepair = mock(() => okAsync(createFoundResult("session-1")));
		getSessionOpenResultMock.mockImplementation(() =>
			okAsync({
				outcome: "preparing" as const,
				requestedSessionId: "session-1",
				repairTicket: "repair-1",
			})
		);

		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			awaitSessionOpenRepair,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		await waitForTimerTurn();
		expect(awaitSessionOpenRepair).toHaveBeenCalledWith("repair-1");
		expect(sessionOpenHydrator.hydrateFound).toHaveBeenCalledTimes(1);
		expect(sessionStore.connection.connectSession).toHaveBeenCalledWith("session-1", {
			openToken: "open-token-1",
			forceReconnect: true,
		});
	});

	it("uses the immediate hydrator result when no panel hydrate is queued", async () => {
		sessionOpenHydrator.hydrateFoundNow = mock(() =>
			ok({
				canonicalSessionId: "session-1",
				openToken: "open-token-1",
				applied: true,
			})
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
		expect(sessionOpenHydrator.hydrateFoundNow).toHaveBeenCalledWith(
			"panel-1",
			"request-1",
			expect.objectContaining({
				outcome: "found",
				canonicalSessionId: "session-1",
			})
		);
		expect(sessionOpenHydrator.hydrateFound).not.toHaveBeenCalled();
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionOpenHydrator.clearAttempt).toHaveBeenCalledWith("panel-1");
	});

	it("hydrates a prepared open result without fetching again", async () => {
		const preparedOpenResult = createFoundResult("session-1");
		sessionOpenHydrator.hydrateFoundNow = mock(() =>
			ok({
				canonicalSessionId: "session-1",
				openToken: "open-token-1",
				applied: true,
			})
		);

		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			preparedOpenResult,
			timeoutMs: 10_000,
			source: "session-handler",
		});
		await waitForTimerTurn();

		expect(getSessionOpenResultMock).not.toHaveBeenCalled();
		expect(sessionOpenHydrator.hydrateFoundNow).toHaveBeenCalledWith(
			"panel-1",
			"request-1",
			preparedOpenResult
		);
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionOpenHydrator.clearAttempt).toHaveBeenCalledWith("panel-1");
	});

	it("ignores a found result when the target panel became stale", async () => {
		let resolveOpenResult: (result: SessionOpenResult) => void = () => {};
		let panelCurrent = true;
		const events: OpenPersistedSessionDiagnosticEvent[] = [];
		const restoreRecorder = setOpenPersistedSessionDiagnosticRecorder((event) => {
			events.push(event);
		});
		getSessionOpenResultMock.mockImplementation(() =>
			ResultAsync.fromSafePromise(
				new Promise<SessionOpenResult>((resolve) => {
					resolveOpenResult = resolve;
				})
			)
		);

		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			isPanelCurrent: () => panelCurrent,
			timeoutMs: 10_000,
			source: "initialization-manager",
		});
		panelCurrent = false;
		resolveOpenResult(createFoundResult("session-1"));

		await waitForTimerTurn();
		restoreRecorder();

		expect(sessionOpenHydrator.hydrateFound).not.toHaveBeenCalled();
		expect(sessionOpenHydrator.clearAttempt).not.toHaveBeenCalled();
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(events.some((event) => event.stage === "stale-panel")).toBe(true);
	});

	it("records diagnostic stages for a successful persisted-session open", async () => {
		const events: OpenPersistedSessionDiagnosticEvent[] = [];
		const restoreRecorder = setOpenPersistedSessionDiagnosticRecorder((event) => {
			events.push(event);
		});
		getSessionOpenResultMock.mockImplementation(() =>
			okAsync(
				createFoundResult("session-1", {
					openResultTiming: {
						source: "provider-owned-snapshot",
						openPath: "legacy_rebuild",
						ledgerProbeStatus: "missing",
						contextMs: 2,
						providerLoadMs: 120,
						ledgerTailReadMs: 0,
						ledgerProjectionFrontierMs: 0,
						ledgerPageReadMs: 0,
						ledgerHeaderDecodeMs: 0,
						ledgerRowsDecodeMs: 0,
						ledgerResultBuildMs: 0,
						runtimeLookupMs: 1,
						assembleMs: 1400,
						restoreAuthorityMs: 90,
						compactMs: 35,
						localJournalFallbackMs: 0,
						totalMs: 1648,
						transcriptEntryCount: 5349,
						operationCount: 406,
					},
					initialTranscriptRowPage: {
						projectionVersion: "transcript_viewport_row:v5",
						startRowIndex: 5221,
						totalRowCount: 5349,
						rowPayloadBytes: 4096,
						transcriptRevision: 1,
						graphRevision: 1,
						lastEventSeq: 1,
						rows: [],
					},
					initialViewportEnvelope: {
						sessionId: "session-1",
						graphRevision: 1,
						lastEventSeq: 1,
						payload: {
							kind: "viewportBufferPush",
							push: {
								sessionId: "session-1",
								graphRevision: {
									graphRevision: 1,
									transcriptRevision: 1,
									lastEventSeq: 1,
								},
								emissionSeq: 0,
								rows: [],
								requestGeneration: null,
								diagnostics: [],
							},
						},
					},
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

		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		restoreRecorder();

		expect(events.map((event) => event.stage)).toContain("started");
		expect(events.map((event) => event.stage)).toContain("request-started");
		expect(events.map((event) => event.stage)).toContain("result-found");
		expect(events.map((event) => event.stage)).toContain("hydrated");
		expect(events.map((event) => event.stage)).toContain("finished");
		const foundEvent = events.find((event) => event.stage === "result-found");
		expect(foundEvent?.canonicalSessionId).toBe("session-1");
		expect(foundEvent?.hasInitialViewportEnvelope).toBe(true);
		expect(foundEvent?.initialRowPageRowCount).toBe(0);
		expect(foundEvent?.initialRowPageTotalRowCount).toBe(5349);
		expect(foundEvent?.initialRowPageStartRowIndex).toBe(5221);
		expect(foundEvent?.initialRowPagePayloadBytes).toBe(4096);
		expect(foundEvent?.openResultTiming).toEqual({
			source: "provider-owned-snapshot",
			openPath: "legacy_rebuild",
			ledgerProbeStatus: "missing",
			contextMs: 2,
			providerLoadMs: 120,
			ledgerTailReadMs: 0,
			ledgerProjectionFrontierMs: 0,
			ledgerPageReadMs: 0,
			ledgerHeaderDecodeMs: 0,
			ledgerRowsDecodeMs: 0,
			ledgerResultBuildMs: 0,
			runtimeLookupMs: 1,
			assembleMs: 1400,
			restoreAuthorityMs: 90,
			compactMs: 35,
			localJournalFallbackMs: 0,
			totalMs: 1648,
			transcriptEntryCount: 5349,
			operationCount: 406,
		});
	});

	it("keeps same-session canonical content visible while refreshing", async () => {
		openPersistedSession({
			panelId: "panel-1",
			sessionId: "session-1",
			sessionStore,
			sessionOpenHydrator,
			getSessionOpenResult: getSessionOpenResultMock,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		expect(sessionStore.clearSessionEntries).not.toHaveBeenCalled();
		expect(sessionStore.loading.setSessionLoading).toHaveBeenCalledWith("session-1");
	});

	it("hydrates the open snapshot before marking loaded for manual and startup opens", async () => {
		const sources = ["session-handler", "initialization-manager"] as const;

		for (const source of sources) {
			const sessionId = source === "session-handler" ? "manual-session" : "startup-session";
			const panelId = source === "session-handler" ? "manual-panel" : "startup-panel";
			const callOrder: string[] = [];

			sessionStore.loading.setSessionLoading = mock((loadedSessionId: string) => {
				callOrder.push(`loading:${loadedSessionId}`);
			});
			sessionStore.loading.setSessionLoaded = mock((loadedSessionId: string) => {
				callOrder.push(`loaded:${loadedSessionId}`);
			});
			setSessionLookup({
				id: sessionId,
				title: "Session",
				projectPath: "/project",
				agentId: "claude-code",
				sourcePath: `/tmp/${sessionId}.jsonl`,
				createdAt: new Date(),
				updatedAt: new Date(),
				parentId: null,
			});
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
			sessionStore.connection.connectSession = mock((connectedSessionId: string) => {
				callOrder.push(`reconnect:${connectedSessionId}`);
				return okAsync({} as ExistingSession);
			});
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
				`reconnect:${sessionId}`,
				`loaded:${sessionId}`,
				`clear:${panelId}`,
			]);
			expect(sessionStore.connection.connectSession).toHaveBeenCalledWith(sessionId, {
				openToken: `open-token-${sessionId}`,
				forceReconnect: true,
			});
			resetOpenPersistedSessionForTests();
		}
	});

	it("hydrates snapshots that were already current without frontend reconnect", async () => {
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

		expect(sessionOpenHydrator.hydrateFound).toHaveBeenCalledWith(
			"panel-1",
			"request-1",
			expect.objectContaining({
				outcome: "found",
				canonicalSessionId: "session-1",
			})
		);
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connection.connectSession).not.toHaveBeenCalled();
	});

	it("reconnects already-current snapshots when canonical state is not sendable", async () => {
		sessionStore.read.getSessionCanSend = mock(() => false);
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

		expect(sessionStore.connection.connectSession).toHaveBeenCalledWith("session-1", {
			openToken: "open-token-1",
			forceReconnect: true,
		});
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionOpenHydrator.clearAttempt).toHaveBeenCalledWith("panel-1");
	});

	it("[E2E] uses canonical session id for store updates when hydration rewrites an alias", async () => {
		// When the backend returns a canonical id different from the requested id (alias),
		// store updates must use the canonical id, not the alias.
		const requestedId = "alias-provider-session";
		const canonicalId = "acepe-canonical-uuid";

		setSessionLookup({
			id: requestedId,
			title: "Aliased session",
			projectPath: "/project",
			agentId: "claude-code",
			sourcePath: "/tmp/alias.jsonl",
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		});
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

		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith(canonicalId);
		expect(sessionStore.connection.connectSession).toHaveBeenCalledWith(canonicalId, {
			openToken: "token-alias",
			forceReconnect: true,
		});
		expect(sessionStore.loading.setSessionLoaded).not.toHaveBeenCalledWith(requestedId);
	});

	it("[E2E] ignores loaded state when the open attempt is superseded by a newer one", async () => {
		// If a panel is retargeted between the open result arriving and hydration completing,
		// isCurrentAttempt returns false and the old attempt must not mark the panel loaded.
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

		expect(sessionStore.connection.connectSession).not.toHaveBeenCalled();
		expect(sessionStore.loading.setSessionLoaded).not.toHaveBeenCalled();
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
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connection.connectSession).not.toHaveBeenCalled();
	});

	it("falls back to local reattach when Rust cannot open a local-created snapshot", async () => {
		getSessionOpenResultMock.mockImplementation(
			() =>
				okAsync({
					outcome: "missing",
					requestedSessionId: "session-1",
				} as SessionOpenResult) as unknown as ReturnType<typeof getSessionOpenResultMock>
		);
		setSessionLookup({
			id: "session-1",
			title: "Session 1",
			projectPath: "/project",
			agentId: "cursor",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created" as const,
			parentId: null,
		});

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
		expect(sessionStore.loading.setSessionLoading).toHaveBeenCalledWith("session-1");
		expect(sessionStore.loading.setLocalCreatedSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.loading.setSessionLoaded).not.toHaveBeenCalled();
		expect(sessionStore.connection.connectSession).toHaveBeenCalledWith("session-1");
	});

	it("falls back to local reattach when local-created snapshot open rejects", async () => {
		getSessionOpenResultMock.mockImplementation(
			() =>
				errAsync(new Error("open snapshot unavailable")) as unknown as ReturnType<
					typeof getSessionOpenResultMock
				>
		);
		setSessionLookup({
			id: "session-1",
			title: "Session 1",
			projectPath: "/project",
			agentId: "cursor",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created" as const,
			parentId: null,
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

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(1);
		expect(sessionStore.loading.setSessionLoading).toHaveBeenCalledWith("session-1");
		expect(sessionStore.loading.setLocalCreatedSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.loading.setSessionLoaded).not.toHaveBeenCalled();
		expect(sessionStore.connection.connectSession).toHaveBeenCalledWith("session-1");
	});

	it("hydrates local-created sessions when Rust can open a canonical snapshot", async () => {
		setSessionLookup({
			id: "session-1",
			title: "Session 1",
			projectPath: "/project",
			agentId: "cursor",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created" as const,
			parentId: null,
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

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getSessionOpenResultMock).toHaveBeenCalledTimes(1);
		expect(sessionOpenHydrator.hydrateFound).toHaveBeenCalledTimes(1);
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connection.connectSession).toHaveBeenCalledWith("session-1", {
			openToken: "open-token-1",
			forceReconnect: true,
		});
		expect(sessionStore.loading.setLocalCreatedSessionLoaded).not.toHaveBeenCalled();
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
		setSessionLookup({
			id: "session-1",
			title: "Session 1",
			projectPath: "/project",
			agentId: "cursor",
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionLifecycleState: "created" as const,
			parentId: null,
		});
		sessionStore.connection.connectSession = mock(() =>
			errAsync(new ConnectionError("session-1", new Error("Resource not found: Session session-1")))
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
		expect(sessionStore.connection.connectSession).toHaveBeenCalledWith("session-1");
		expect(sessionStore.loading.setLocalCreatedSessionLoaded).not.toHaveBeenCalled();
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		// Must NOT carry symbols of the deleted gate.
		expect(
			(sessionStore as unknown as Record<string, unknown>)["setSessionOpenMissing"]
		).toBeUndefined();
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
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connection.connectSession).not.toHaveBeenCalled();
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
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connection.connectSession).not.toHaveBeenCalled();
	});

	it("does not synthesize Cursor-specific copy for legacy store.db history sessions", async () => {
		// GOD: agent-specific copy lives in TS failure-copy mapper (Unit 5),
		// keyed on (agentId, lifecycle.failureReason) — never synthesized here.
		setSessionLookup({
			id: "session-1",
			title: "Cursor Session",
			projectPath: "/project",
			agentId: "cursor",
			sourcePath: "/tmp/session-1.store.db",
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		});
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
		expect(sessionStore.loading.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connection.connectSession).not.toHaveBeenCalled();
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
		activity: {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
		activeStreamingTail: null,
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
		openPath: overrides?.openPath ?? "legacy_rebuild",
		sequenceId: overrides?.sequenceId ?? null,
	};
}
