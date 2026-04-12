import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync, ResultAsync } from "neverthrow";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionProjectionHydrator } from "$lib/acp/store/services/session-projection-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { Session } from "$lib/acp/store/types.js";

import { preloadAndConnectSession } from "../logic/session-preload-connect.js";

type SessionPreloadStore = Pick<
	SessionStore,
	"setSessionLoading" | "setSessionLoaded" | "removeSession" | "preloadSessions" | "connectSession"
>;

type ProjectionHydrator = Pick<SessionProjectionHydrator, "hydrateSession" | "clearSession">;

interface PreloadResult {
	readonly loaded: Session[];
	readonly missing: string[];
}

describe("preloadAndConnectSession", () => {
	let resolvePreload: ((value: PreloadResult) => void) | null;
	let sessionStore: SessionPreloadStore;
	let projectionHydrator: ProjectionHydrator;
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

		projectionHydrator = {
			hydrateSession: mock(() => okAsync(undefined)),
			clearSession: mock(() => {}),
		};

		panelStore = {
			closePanelBySessionId: mock(() => {}),
		};
	});

	it("dedupes concurrent calls for the same session", async () => {
		preloadAndConnectSession({
			sessionId: "session-1",
			sessionStore,
			projectionHydrator,
			panelStore,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		preloadAndConnectSession({
			sessionId: "session-1",
			sessionStore,
			projectionHydrator,
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
			projectionHydrator,
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
		expect(projectionHydrator.hydrateSession).toHaveBeenNthCalledWith(1, "session-1", {
			includePendingTurnInputs: false,
		});
		expect(projectionHydrator.hydrateSession).toHaveBeenNthCalledWith(2, "session-1");
		expect(sessionStore.connectSession).toHaveBeenCalledTimes(1);
	});

	it("connects even when preload reports the session content as missing", async () => {
		preloadAndConnectSession({
			sessionId: "session-1",
			sessionStore,
			projectionHydrator,
			panelStore,
			timeoutMs: 10_000,
			source: "session-handler",
		});

		const resolver = resolvePreload;
		expect(resolver).not.toBeNull();
		if (resolver) {
			resolver({ loaded: [], missing: ["session-1"] });
		}

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(projectionHydrator.clearSession).toHaveBeenCalledWith("session-1");
		expect(projectionHydrator.hydrateSession).toHaveBeenCalledTimes(1);
		expect(projectionHydrator.hydrateSession).toHaveBeenCalledWith("session-1");
		expect(sessionStore.setSessionLoaded).toHaveBeenCalledWith("session-1");
		expect(sessionStore.connectSession).toHaveBeenCalledTimes(1);
	});
});

function createMockSession(id: string): Session {
	const mock = { id };
	return mock as Session;
}
