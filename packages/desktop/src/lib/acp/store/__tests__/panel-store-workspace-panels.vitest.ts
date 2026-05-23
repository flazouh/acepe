import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

let originalLocalStorageDescriptor: PropertyDescriptor | undefined;

function createStore(): PanelStore {
	const sessionStore = {
		getSessionCold: vi.fn(() => null),
		getSessionIdentity: vi.fn(() => undefined),
		getSessionMetadata: vi.fn(() => undefined),
	} as unknown as SessionStore;
	const agentStore = {
		getDefaultAgentId: vi.fn(() => "claude-code"),
	} as unknown as AgentStore;
	const persist = vi.fn();

	return new PanelStore(sessionStore, agentStore, persist);
}

beforeEach(() => {
	originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	const localStorageStub: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
		removeItem: vi.fn(),
	};
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: localStorageStub,
	});
});

afterEach(() => {
	if (originalLocalStorageDescriptor === undefined) {
		Reflect.deleteProperty(globalThis, "localStorage");
		return;
	}

	Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
});

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

	it("resolves the focused agent panel from the panel index", () => {
		const store = createStore();
		const panel = store.spawnPanel();

		store.focusPanel(panel.id);

		expect(store.focusedPanel).toBe(panel);
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

	it("keeps an existing agent panel ref stable while its host is being removed", () => {
		const store = createStore();
		const panel = store.spawnPanel({ projectPath: "/tmp/project" });
		const panelRef = store.getTopLevelAgentPanelRef(panel.id);
		const mountedPanelSnapshot = panelRef.current;

		store.closePanel(panel.id);

		expect(panelRef.current).toBe(mountedPanelSnapshot);
		expect(store.getTopLevelAgentPanel(panel.id)).toBeUndefined();
		expect(store.getTopLevelAgentPanelRef(panel.id).current).toBeNull();
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
		expect(store.focusedTopLevelPanel).toBe(filePanel);
	});

	it("stores file panel target location metadata", () => {
		const store = createStore();

		const filePanel = store.openFilePanel("src/main.ts", "/tmp/project", {
			targetLine: 12,
			targetColumn: 4,
		});

		expect(filePanel).toMatchObject({
			filePath: "src/main.ts",
			targetLine: 12,
			targetColumn: 4,
		});
	});

	it("keeps indexed file panel lookups current across open, resize, and close", () => {
		const store = createStore();

		const filePanel = store.openFilePanel("src/main.ts", "/tmp/project");

		expect(store.getFilePanel(filePanel.id)).toBe(filePanel);
		expect(store.getFilePanelByPath("src/main.ts", "/tmp/project")).toBe(filePanel);
		expect(store.isFileOpen("src/main.ts", "/tmp/project")).toBe(true);

		store.resizeFilePanel(filePanel.id, 25);
		const resizedPanel = store.getFilePanel(filePanel.id);
		expect(resizedPanel?.width).toBe(filePanel.width + 25);
		expect(store.getFilePanelByPath("src/main.ts", "/tmp/project")).toBe(resizedPanel);

		store.closeFilePanel(filePanel.id);
		expect(store.getFilePanel(filePanel.id)).toBeUndefined();
		expect(store.getFilePanelByPath("src/main.ts", "/tmp/project")).toBeUndefined();
		expect(store.isFileOpen("src/main.ts", "/tmp/project")).toBe(false);
	});

	it("selects top-level file panels through the file panel index", () => {
		const store = createStore();
		const firstPanel = store.openFilePanel("src/one.ts", "/tmp/project");
		const secondPanel = store.openFilePanel("src/two.ts", "/tmp/project");

		store.setActiveTopLevelFilePanel("/tmp/project", firstPanel.id);

		expect(store.getActiveTopLevelFilePanelId("/tmp/project")).toBe(firstPanel.id);
		store.closeFilePanel(secondPanel.id);
		expect(store.getFilePanel(firstPanel.id)).toMatchObject({
			id: firstPanel.id,
			filePath: "src/one.ts",
			projectPath: "/tmp/project",
			ownerPanelId: null,
		});
	});

	it("selects top-level file panel groups without scanning attached panels", () => {
		const store = createStore();
		const owner = store.spawnPanel({ projectPath: "/tmp/project" });
		const firstPanel = store.openFilePanel("src/one.ts", "/tmp/project");
		const attachedPanel = store.openFilePanel("src/attached.ts", "/tmp/project", {
			ownerPanelId: owner.id,
		});
		const secondPanel = store.openFilePanel("src/two.ts", "/tmp/project");

		expect(store.getTopLevelFilePanels()).toEqual([secondPanel, firstPanel]);
		expect(store.getTopLevelFilePanelsForProject("/tmp/project")).toEqual([
			secondPanel,
			firstPanel,
		]);
		expect(store.getFilePanelsForProject("/tmp/project")).toEqual([
			secondPanel,
			attachedPanel,
			firstPanel,
		]);
		expect(store.getTopLevelFilePanelsForProject("/tmp/other")).toEqual([]);
		expect(store.getFilePanelsForProject("/tmp/other")).toEqual([]);
	});

	it("falls back to attached file panel groups without scanning all file panels", () => {
		const store = createStore();
		const owner = store.spawnPanel({ projectPath: "/tmp/project" });
		const attachedPanel = store.openFilePanel("src/attached.ts", "/tmp/project", {
			ownerPanelId: owner.id,
		});

		expect(store.getActiveAttachedFilePanel(owner.id)).toBe(attachedPanel);
	});

	it("closes a top-level non-agent workspace panel through closePanel", () => {
		const store = createStore();

		const terminalPanel = store.openTerminalPanel("/tmp/project");

		store.closePanel(terminalPanel.id);

		expect(store.workspacePanels.some((panel) => panel.id === terminalPanel.id)).toBe(false);
	});

	it("selects browser panels by project through the panel index", () => {
		const store = createStore();
		const firstPanel = store.openBrowserPanel("/tmp/project", "https://one.example", "One");
		const otherPanel = store.openBrowserPanel("/tmp/other", "https://other.example", "Other");
		const secondPanel = store.openBrowserPanel("/tmp/project", "https://two.example", "Two");

		expect(store.getBrowserPanelsForProject("/tmp/project")).toEqual([
			secondPanel,
			firstPanel,
		]);
		expect(store.getBrowserPanelsForProject("/tmp/other")).toEqual([otherPanel]);
		expect(store.getBrowserPanelsForProject("/tmp/missing")).toEqual([]);
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
			getSessionIdentity: vi.fn((sessionId: string) =>
				sessionId === "session-1"
					? {
							id: "session-1",
							projectPath: "/tmp/project",
							agentId: "cursor",
						}
					: undefined
			),
			getSessionMetadata: vi.fn((sessionId: string) =>
				sessionId === "session-1"
					? {
							title: "Hello",
							createdAt: new Date("2026-01-01T00:00:00.000Z"),
							updatedAt: new Date("2026-01-01T00:00:00.000Z"),
							parentId: null,
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

	it("clears panel-owned session metadata when attaching a missing session", () => {
		const store = createStore();

		const panel = store.spawnPanel({
			selectedAgentId: "cursor",
			projectPath: "/tmp/project",
		});

		store.updatePanelSession(panel.id, "missing-session");

		expect(store.panels[0]).toMatchObject({
			id: panel.id,
			sessionId: "missing-session",
			projectPath: null,
			agentId: null,
			sourcePath: null,
			worktreePath: null,
			sessionTitle: null,
		});
	});

	it("keeps panel project and agent while a deferred session is waiting for promotion", () => {
		const sessionStore = {
			getSessionIdentity: vi.fn(() => undefined),
			getSessionMetadata: vi.fn(() => undefined),
			hasPendingCreationSession: vi.fn((sessionId: string) => sessionId === "pending-session"),
		} as unknown as SessionStore;
		const agentStore = {
			getDefaultAgentId: vi.fn(() => "claude-code"),
		} as unknown as AgentStore;
		const store = new PanelStore(sessionStore, agentStore, vi.fn());

		const panel = store.spawnPanel({
			selectedAgentId: "claude-code",
			projectPath: "/tmp/project",
			pendingWorktreeEnabled: true,
		});

		store.updatePanelSession(panel.id, "pending-session");

		expect(store.panels[0]).toMatchObject({
			id: panel.id,
			sessionId: "pending-session",
			projectPath: "/tmp/project",
			agentId: "claude-code",
			pendingWorktreeEnabled: null,
		});
	});

	it("derives top-level agent project refs without rebuilding panel snapshots", () => {
		const sessionStore = {
			getSessionIdentity: vi.fn((sessionId: string) =>
				sessionId === "session-1"
					? {
							id: "session-1",
							projectPath: "/tmp/project-b",
							agentId: "cursor",
						}
					: undefined
			),
			getSessionMetadata: vi.fn((sessionId: string) =>
				sessionId === "session-1"
					? {
							title: "Hello",
							createdAt: new Date("2026-01-01T00:00:00.000Z"),
							updatedAt: new Date("2026-01-01T00:00:00.000Z"),
							parentId: null,
							sequenceId: 42,
						}
					: undefined
			),
		} as unknown as SessionStore;
		const agentStore = {
			getDefaultAgentId: vi.fn(() => "claude-code"),
		} as unknown as AgentStore;
		const store = new PanelStore(sessionStore, agentStore, vi.fn());

		const disconnectedPanel = store.spawnPanel({
			projectPath: "/tmp/project-a",
			selectedAgentId: "claude-code",
		});
		const connectedPanel = store.spawnPanel({
			projectPath: "/tmp/project-a",
			selectedAgentId: "cursor",
		});

		store.updatePanelSession(connectedPanel.id, "session-1");

		expect(store.getTopLevelAgentPanelIds()).toEqual([connectedPanel.id, disconnectedPanel.id]);
		expect(store.getTopLevelAgentPanelProjectRefs()).toEqual([
			{
				id: connectedPanel.id,
				sessionProjectPath: "/tmp/project-b",
				sessionSequenceId: 42,
			},
			{
				id: disconnectedPanel.id,
				sessionProjectPath: "/tmp/project-a",
				sessionSequenceId: null,
			},
		]);
	});

	it("does not use panel project path for existing sessions missing cold identity", () => {
		const store = createStore();

		const panel = store.spawnPanel({
			projectPath: "/tmp/project-a",
			selectedAgentId: "cursor",
		});

		store.updatePanelSession(panel.id, "missing-session");

		expect(store.getTopLevelAgentPanelProjectRefs()).toEqual([
			{
				id: panel.id,
				sessionProjectPath: null,
				sessionSequenceId: null,
			},
		]);
	});
});
