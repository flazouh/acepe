import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync, ResultAsync } from "neverthrow";
import type { SessionOpenResult } from "$lib/services/acp-types.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";

const getSessionOpenResultMock = mock(() => okAsync(createFoundResult("session-1")));

let openPersistedSession: typeof import("../logic/open-persisted-session.js").openPersistedSession;
let resetOpenPersistedSessionForTests: typeof import("../logic/open-persisted-session.js").__resetOpenPersistedSessionForTests;

type SessionOpenStore = Pick<
	SessionStore,
	"setSessionLoading" | "setSessionLoaded" | "connectSession" | "getSessionCold"
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
			connectSession: mock(() => okAsync(undefined)),
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
		expect(sessionStore.connectSession).toHaveBeenCalledTimes(1);
	});

	it("hydrates before connecting after a found result", async () => {
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
		expect(sessionStore.connectSession).toHaveBeenCalledWith("session-1", {
			openToken: "open-token-1",
		});
	});

	it("marks the session loaded without connecting when the result is missing", async () => {
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

function createFoundResult(sessionId: string): SessionOpenResult {
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
		messageCount: 0,
		threadEntries: [],
		sessionTitle: "Session 1",
		operations: [],
		interactions: [],
		turnState: "Idle",
	};
}
