import { describe, expect, it, vi } from "vitest";

import type { AgentStore } from "../agent-store.svelte.js";
import { PanelStore } from "../panel-store.svelte.js";
import type { SessionStore } from "../session-store.svelte.js";

type GitDialogCapableStore = PanelStore & {
	openGitDialog: (
		projectPath: string,
		width?: number
	) => {
		id: string;
		projectPath: string;
		width: number;
		initialTarget?: undefined;
	};
	gitDialog: {
		id: string;
		projectPath: string;
		width: number;
		initialTarget?: undefined;
	} | null;
};

function createStore(): PanelStore {
	const sessionStore = {
		getSessionCold: vi.fn(() => null),
	} as unknown as SessionStore;
	const agentStore = {
		getDefaultAgentId: vi.fn(() => "claude-code"),
	} as unknown as AgentStore;
	const persist = vi.fn();

	return new PanelStore(sessionStore, agentStore, persist);
}

describe("PanelStore workspacePanels", () => {
	it("stores agent panels in the canonical workspace panel list", () => {
		const store = createStore();

		const panel = store.spawnPanel();

		expect(store.workspacePanels).toHaveLength(1);
		expect(store.workspacePanels[0]).toMatchObject({
			id: panel.id,
			kind: "agent",
			ownerPanelId: null,
		});
	});

	it("stores the seeded pending worktree choice for fresh panels", () => {
		const store = createStore();

		const panel = store.spawnPanel({
			projectPath: "/tmp/project",
			pendingWorktreeEnabled: true,
		});

		expect(panel).toMatchObject({
			id: panel.id,
			pendingWorktreeEnabled: true,
		});
		expect(store.workspacePanels[0]).toMatchObject({
			id: panel.id,
			pendingWorktreeEnabled: true,
		});
	});

	it("stores file, terminal, and browser panels in the canonical workspace panel list", () => {
		const store = createStore();

		store.openFilePanel("src/main.ts", "/tmp/project");
		store.openTerminalPanel("/tmp/project");
		store.openBrowserPanel("/tmp/project", "https://example.com", "Example");

		expect(store.workspacePanels.map((panel) => panel.kind)).toEqual([
			"browser",
			"file",
			"terminal",
		]);
	});

	it("focuses a top-level non-agent workspace panel by id", () => {
		const store = createStore();

		const filePanel = store.openFilePanel("src/main.ts", "/tmp/project");

		store.focusPanel(filePanel.id);

		expect(store.focusedPanelId).toBe(filePanel.id);
	});

	it("closes a top-level non-agent workspace panel through closePanel", () => {
		const store = createStore();

		const terminalPanel = store.openTerminalPanel("/tmp/project");

		store.closePanel(terminalPanel.id);

		expect(store.workspacePanels.some((panel) => panel.id === terminalPanel.id)).toBe(false);
	});

	it("opens source control as a dialog without creating a workspace panel", () => {
		const store = createStore() as GitDialogCapableStore;

		store.viewMode = "project";
		store.focusedViewProjectPath = "/tmp/project-a";

		const gitDialog = store.openGitDialog("/tmp/project-b");

		expect(store.workspacePanels).toHaveLength(0);
		expect(store.focusedPanelId).toBeNull();
		expect(store.focusedViewProjectPath).toBe("/tmp/project-b");
		expect(store.gitDialog).toEqual({
			id: gitDialog.id,
			projectPath: "/tmp/project-b",
			width: gitDialog.width,
			initialTarget: undefined,
		});
	});

	it("hydrates panel metadata when attaching a session", () => {
		const sessionStore = {
			getSessionCold: vi.fn((sessionId: string) =>
				sessionId === "session-1"
					? {
							id: "session-1",
							projectPath: "/tmp/project",
							agentId: "cursor",
							title: "Hello",
						}
					: null
			),
		} as unknown as SessionStore;
		const agentStore = {
			getDefaultAgentId: vi.fn(() => "claude-code"),
		} as unknown as AgentStore;
		const store = new PanelStore(sessionStore, agentStore, vi.fn());

		const panel = store.spawnPanel({
			selectedAgentId: "cursor",
			projectPath: "/tmp/project",
			pendingWorktreeEnabled: true,
		});

		store.updatePanelSession(panel.id, "session-1");

		expect(store.panels[0]).toMatchObject({
			id: panel.id,
			sessionId: "session-1",
			projectPath: "/tmp/project",
			agentId: "cursor",
			sessionTitle: "Hello",
			pendingWorktreeEnabled: null,
		});
	});
});
