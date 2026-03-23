import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync, ResultAsync } from "neverthrow";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { Session } from "$lib/acp/store/types.js";

import { preloadAndConnectSession } from "../logic/session-preload-connect.js";

type SessionPreloadStore = Pick<
	SessionStore,
	"setSessionLoading" | "setSessionLoaded" | "removeSession" | "preloadSessions" | "connectSession"
>;

interface PreloadResult {
	readonly loaded: Session[];
	readonly missing: string[];
}

describe("preloadAndConnectSession", () => {
	let resolvePreload: ((value: PreloadResult) => void) | null;
	let sessionStore: SessionPreloadStore;
	let panelStore: Pick<PanelStore, "closePanelBySessionId">;

	beforeEach(() => {
		resolvePreload = null;
		const mockSession = createMockSession("session-1");

		sessionStore = {
			setSessionLoading: mock(() => {}),
			setSessionLoaded: mock(() => {}),
			removeSession: mock(() => {}),
			preloadSessions: mock(() =>
				ResultAsync.fromSafePromise(
					new Promise<PreloadResult>((resolve) => {
						resolvePreload = resolve;
					})
				)
			),
			connectSession: mock(() => okAsync(mockSession)),
		};

		panelStore = {
			closePanelBySessionId: mock(() => {}),
		};
	});

	it("dedupes concurrent calls for the same session", async () => {
		preloadAndConnectSession({
			sessionId: "session-1",
			sessionStore,
			panelStore,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		preloadAndConnectSession({
			sessionId: "session-1",
			sessionStore,
			panelStore,
			timeoutMs: 10_000,
			source: "panels-container",
		});

		expect(sessionStore.preloadSessions).toHaveBeenCalledTimes(1);

		const resolver = resolvePreload;
		expect(resolver).not.toBeNull();
		if (resolver) {
			resolver({ loaded: [createMockSession("session-1")], missing: [] });
		}

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sessionStore.connectSession).toHaveBeenCalledTimes(1);
	});

	it("always connects after successful preload", async () => {
		preloadAndConnectSession({
			sessionId: "session-1",
			sessionStore,
			panelStore,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		const resolver = resolvePreload;
		expect(resolver).not.toBeNull();
		if (resolver) {
			resolver({ loaded: [createMockSession("session-1")], missing: [] });
		}

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sessionStore.connectSession).toHaveBeenCalledTimes(1);
	});
});

function createMockSession(id: string): Session {
	const mock = { id };
	return mock as Session;
}
