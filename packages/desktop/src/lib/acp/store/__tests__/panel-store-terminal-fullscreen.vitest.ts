import { describe, expect, it, vi } from "vitest";

import type { AgentStore } from "../agent-store.svelte.js";
import { PanelStore } from "../panel-store.svelte.js";
import type { SessionStore } from "../session-store.svelte.js";

function createStore(): PanelStore {
	const sessionStore = {} as SessionStore;
	const agentStore = {} as AgentStore;
	const persist = vi.fn();

	return new PanelStore(sessionStore, agentStore, persist);
}

describe("PanelStore terminal fullscreen", () => {
	it("enters fullscreen for a terminal without creating an agent panel", () => {
		const store = createStore();
		const terminalPanel = store.openTerminalPanel("/tmp/project");

		expect(store.panels).toHaveLength(0);
		expect(store.fullscreenPanelId).toBeNull();

		store.enterTerminalFullscreen(terminalPanel.id);

		expect(store.panels).toHaveLength(0);
		expect(store.fullscreenAuxPanel).toEqual({
			kind: "terminal",
			id: terminalPanel.id,
		});
		expect(store.fullscreenPanelId).toBeNull();
		expect(store.fullscreenAuxOnly).toBe(true);
	});
});
