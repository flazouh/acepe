import { describe, expect, it, vi } from "vitest";

import type { AgentStore } from "../agent-store.svelte.js";
import { PanelStore } from "../panel-store.svelte.js";
import type { SessionStore } from "../session-store.svelte.js";

Object.defineProperty(globalThis, "localStorage", {
	value: {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
		removeItem: vi.fn(),
	},
	configurable: true,
});

interface SessionStub {
	readonly id: string;
	readonly projectPath: string;
	readonly agentId: string;
	readonly title: string | null;
	readonly sourcePath?: string | null;
	readonly worktreePath?: string | null;
}

function createStore(sessionStubs: readonly SessionStub[] = []): PanelStore {
	const sessionStore = {
		getSessionCold: vi.fn((sessionId: string) => {
			for (const session of sessionStubs) {
				if (session.id === sessionId) {
					return session;
				}
			}
			return null;
		}),
	} as unknown as SessionStore;
	const agentStore = {
		getDefaultAgentId: vi.fn(() => "claude-code"),
	} as unknown as AgentStore;
	const persist = vi.fn();

	return new PanelStore(sessionStore, agentStore, persist);
}

describe("PanelStore materializeSessionPanel", () => {
	it("creates a hidden session panel without changing focusedPanelId, viewMode, or fullscreen selection", () => {
		const store = createStore([
			{
				id: "session-2",
				projectPath: "/tmp/project-b",
				agentId: "cursor",
				title: "Background task",
			},
		]);
		const visiblePanel = store.spawnPanel({ projectPath: "/tmp/project-a" });
		store.viewMode = "single";
		store.focusedPanelId = visiblePanel.id;

		const materialized = store.materializeSessionPanel("session-2", 450);

		expect(materialized).not.toBeNull();
		expect(store.focusedPanelId).toBe(visiblePanel.id);
		expect(store.viewMode).toBe("single");
		expect(store.fullscreenPanelId).toBeNull();
		expect(store.panels.map((panel) => panel.sessionId)).toEqual([null, "session-2"]);
	});

	it("reuses an existing session panel instead of creating a duplicate", () => {
		const store = createStore([
			{
				id: "session-1",
				projectPath: "/tmp/project-a",
				agentId: "claude",
				title: "Existing task",
			},
		]);

		const first = store.materializeSessionPanel("session-1", 450);
		const second = store.materializeSessionPanel("session-1", 450);

		expect(first).not.toBeNull();
		expect(second?.id).toBe(first?.id);
		expect(store.panels).toHaveLength(1);
	});

	it("appends background-created panels after the current panel order", () => {
		const store = createStore([
			{
				id: "session-3",
				projectPath: "/tmp/project-c",
				agentId: "claude",
				title: "Newest hidden task",
			},
		]);
		const first = store.spawnPanel({ projectPath: "/tmp/project-a" });
		const second = store.spawnPanel({ projectPath: "/tmp/project-b" });

		const materialized = store.materializeSessionPanel("session-3", 450);

		expect(materialized).not.toBeNull();
		expect(store.panels.map((panel) => panel.id)).toEqual([
			second.id,
			first.id,
			materialized ? materialized.id : "",
		]);
	});

	it("keeps openSession focus-stealing behavior for explicit opens", () => {
		const store = createStore([
			{
				id: "session-4",
				projectPath: "/tmp/project-d",
				agentId: "claude",
				title: "Explicit open",
			},
		]);
		const visiblePanel = store.spawnPanel({ projectPath: "/tmp/project-a" });
		store.viewMode = "single";
		store.focusedPanelId = visiblePanel.id;

		const opened = store.openSession("session-4", 450);

		expect(opened).not.toBeNull();
		expect(store.focusedPanelId).toBe(opened ? opened.id : null);
		expect(store.viewMode).toBe("single");
	});

	it("marks background-created panels as auto-created and promotes them on explicit open", () => {
		const store = createStore([
			{
				id: "session-5",
				projectPath: "/tmp/project-e",
				agentId: "claude",
				title: "Auto-created task",
			},
		]);

		store.materializeSessionPanel("session-5", 450);
		expect(store.getPanelBySessionId("session-5")?.autoCreated).toBe(true);

		store.openSession("session-5", 450);

		expect(store.getPanelBySessionId("session-5")?.autoCreated).toBe(false);
	});

	it("suppresses auto-rematerialization until the live signal changes or the user explicitly reopens", () => {
		const store = createStore([
			{
				id: "session-6",
				projectPath: "/tmp/project-f",
				agentId: "claude",
				title: "Dismiss me",
			},
		]);

		const materialized = store.materializeSessionPanel("session-6", 450);
		expect(materialized).not.toBeNull();

		const initialSuppressed = store.syncAutoSessionSuppression("session-6", "signal-1");
		expect(initialSuppressed).toBe(false);

		store.closePanel(materialized ? materialized.id : "");

		expect(store.syncAutoSessionSuppression("session-6", "signal-1")).toBe(true);
		expect(store.syncAutoSessionSuppression("session-6", "signal-2")).toBe(false);

		store.openSession("session-6", 450);

		expect(store.syncAutoSessionSuppression("session-6", "signal-2")).toBe(false);
		expect(store.getPanelBySessionId("session-6")?.autoCreated).toBe(false);
	});
});
