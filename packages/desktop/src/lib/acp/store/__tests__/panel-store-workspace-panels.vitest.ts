import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModifiedFilesState } from "../../types/modified-files-state.js";
import type { AgentStore } from "../agent-store.svelte.js";
import { createFilePanelCacheKey } from "../file-panel-ownership.js";
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

function createModifiedFilesState(): ModifiedFilesState {
	return {
		files: [],
		byPath: new Map(),
		fileCount: 0,
		totalEditCount: 0,
	};
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

	it("selects top-level agent panels by project through the panel index", () => {
		const store = createStore();
		const firstPanel = store.spawnPanel({ projectPath: "/tmp/project" });
		const otherPanel = store.spawnPanel({ projectPath: "/tmp/other" });
		const secondPanel = store.spawnPanel({ projectPath: "/tmp/project" });

		store.panels = store.panels.map((panel) =>
			panel.id === secondPanel.id ? { ...panel, sessionId: "session-2" } : panel
		);

		expect(store.getTopLevelAgentPanelsForProject("/tmp/project").map((panel) => panel.id)).toEqual([
			secondPanel.id,
			firstPanel.id,
		]);
		expect(store.getTopLevelAgentPanels().map((panel) => panel.id)).toEqual([
			secondPanel.id,
			otherPanel.id,
			firstPanel.id,
		]);
		expect(store.getTopLevelAgentPanelsForProject("/tmp/other").map((panel) => panel.id)).toEqual([
			otherPanel.id,
		]);
		expect(store.getPanel(secondPanel.id)).toMatchObject({
			id: secondPanel.id,
			sessionId: "session-2",
		});
		expect(store.getFirstSessionAgentPanelForProject("/tmp/project")?.id).toBe(secondPanel.id);
		expect(store.getTopLevelAgentPanelsForProject("/tmp/missing")).toEqual([]);
		expect(store.getFirstSessionAgentPanelForProject("/tmp/missing")).toBeUndefined();
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
		expect(store.getFirstTopLevelPanel()?.kind).toBe("browser");
	});

	it("removes project workspace panels through indexed store state", () => {
		const store = createStore();
		const removedAgent = store.spawnPanel({ projectPath: "/tmp/remove" });
		const keptAgent = store.spawnPanel({ projectPath: "/tmp/keep" });
		const removedFile = store.openFilePanel("src/remove.ts", "/tmp/remove");
		const keptFile = store.openFilePanel("src/keep.ts", "/tmp/keep");
		const removedBrowser = store.openBrowserPanel("/tmp/remove", "https://remove.example", "Remove");
		const keptBrowser = store.openBrowserPanel("/tmp/keep", "https://keep.example", "Keep");

		store.removeWorkspacePanelsForProject("/tmp/remove");

		expect(store.getTopLevelAgentPanel(removedAgent.id)).toBeUndefined();
		expect(store.getTopLevelAgentPanel(keptAgent.id)?.id).toBe(keptAgent.id);
		expect(store.getFilePanel(removedFile.id)).toBeUndefined();
		expect(store.getFilePanel(keptFile.id)?.id).toBe(keptFile.id);
		expect(store.getBrowserPanelsForProject("/tmp/remove")).toEqual([]);
		expect(store.getBrowserPanelsForProject("/tmp/keep").map((panel) => panel.id)).toEqual([
			keptBrowser.id,
		]);
		expect(store.workspacePanels.map((panel) => panel.id)).not.toContain(removedBrowser.id);
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

	it("closes file panels without filtering the whole workspace panel list", () => {
		const store = createStore();
		const filePanel = store.openFilePanel("src/main.ts", "/tmp/project");
		const originalFilter = store.workspacePanels.filter;

		store.workspacePanels.filter = () => {
			throw new Error("must not filter workspace panels while closing a file");
		};

		try {
			store.closeFilePanel(filePanel.id);

			expect(store.getFilePanel(filePanel.id)).toBeUndefined();
			expect(store.getFilePanelByPath("src/main.ts", "/tmp/project")).toBeUndefined();
			expect(store.workspacePanels.length).toBe(0);
		} finally {
			store.workspacePanels.filter = originalFilter;
		}
	});

	it("closes attached file panels without scanning all file panels for owner fallback", () => {
		const store = createStore();
		const owner = store.spawnPanel({ projectPath: "/tmp/project" });
		const firstPanel = store.openFilePanel("src/one.ts", "/tmp/project", {
			ownerPanelId: owner.id,
		});
		const secondPanel = store.openFilePanel("src/two.ts", "/tmp/project", {
			ownerPanelId: owner.id,
		});
		const originalFilter = store.workspacePanels.filter;

		store.workspacePanels.filter = () => {
			throw new Error("must not filter workspace panels while closing an attached file");
		};

		try {
			store.closeFilePanel(secondPanel.id);

			expect(store.getActiveAttachedFilePanel(owner.id)).toBe(firstPanel);
			expect(store.getAttachedFilePanels(owner.id)).toEqual([firstPanel]);
		} finally {
			store.workspacePanels.filter = originalFilter;
		}
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

	it("selects top-level non-agent project refs without exposing attached panels", () => {
		const store = createStore();
		const owner = store.spawnPanel({ projectPath: "/tmp/project" });
		const filePanel = store.openFilePanel("src/main.ts", "/tmp/project");
		store.openFilePanel("src/attached.ts", "/tmp/project", {
			ownerPanelId: owner.id,
		});
		const terminalPanel = store.openTerminalPanel("/tmp/project");
		const browserPanel = store.openBrowserPanel("/tmp/project", "https://example.com");

		expect(store.getTopLevelNonAgentPanelProjectRefs()).toEqual([
			{ id: browserPanel.id, projectPath: "/tmp/project" },
			{ id: filePanel.id, projectPath: "/tmp/project" },
			{ id: terminalPanel.id, projectPath: "/tmp/project" },
		]);
	});

	it("selects persistable workspace panels without auto-created owners or their attached panels", () => {
		const store = createStore();
		const durableOwner = store.spawnPanel({ projectPath: "/tmp/project" });
		const autoOwner = store.spawnPanel({ projectPath: "/tmp/project" });
		store.restoreWorkspacePanels(
			store.workspacePanels.map((panel) =>
				panel.id === autoOwner.id && panel.kind === "agent"
					? { ...panel, autoCreated: true }
					: panel
			)
		);
		const durableAttachedPanel = store.openFilePanel("src/durable.ts", "/tmp/project", {
			ownerPanelId: durableOwner.id,
		});
		const autoAttachedPanel = store.openFilePanel("src/auto.ts", "/tmp/project", {
			ownerPanelId: autoOwner.id,
		});
		const persistablePanelIds = store.getPersistableWorkspacePanels().map((panel) => panel.id);

		expect(persistablePanelIds).toContain(durableOwner.id);
		expect(persistablePanelIds).toContain(durableAttachedPanel.id);
		expect(persistablePanelIds).not.toContain(autoOwner.id);
		expect(persistablePanelIds).not.toContain(autoAttachedPanel.id);
	});

	it("falls back to attached file panel groups without scanning all file panels", () => {
		const store = createStore();
		const owner = store.spawnPanel({ projectPath: "/tmp/project" });
		const attachedPanel = store.openFilePanel("src/attached.ts", "/tmp/project", {
			ownerPanelId: owner.id,
		});

		expect(store.getActiveAttachedFilePanel(owner.id)).toBe(attachedPanel);
	});

	it("opens attached file panels without filtering the whole workspace panel list", () => {
		const store = createStore();
		const owner = store.spawnPanel({ projectPath: "/tmp/project" });
		const originalFilter = store.workspacePanels.filter;

		store.workspacePanels.filter = () => {
			throw new Error("must not scan workspace panels while opening a file");
		};

		try {
			const attachedPanel = store.openFilePanel("src/attached.ts", "/tmp/project", {
				ownerPanelId: owner.id,
			});

			expect(store.getFilePanel(attachedPanel.id)).toBe(attachedPanel);
			expect(store.getFilePanelByPath("src/attached.ts", "/tmp/project")).toBeUndefined();
			expect(store.getAttachedFilePanels(owner.id)).toEqual([attachedPanel]);
			expect(store.getActiveAttachedFilePanel(owner.id)).toBe(attachedPanel);
		} finally {
			store.workspacePanels.filter = originalFilter;
		}
	});

	it("widens attached file owners without rebuilding panel lists", () => {
		const store = createStore();
		const owner = store.spawnPanel({ projectPath: "/tmp/project" });
		const originalFilter = store.workspacePanels.filter;

		store.workspacePanels.filter = () => {
			throw new Error("must not filter workspace panels while widening an owner");
		};

		try {
			store.openFilePanel("src/wide.ts", "/tmp/project", {
				ownerPanelId: owner.id,
				width: owner.width + 120,
			});

			expect(store.getTopLevelAgentPanel(owner.id)?.width).toBe(owner.width + 120);
		} finally {
			store.workspacePanels.filter = originalFilter;
		}
	});

	it("opens file panels without copying the whole workspace panel list", () => {
		const store = createStore();
		store.spawnPanel({ projectPath: "/tmp/project" });
		const originalIterator = store.workspacePanels[Symbol.iterator];

		store.workspacePanels[Symbol.iterator] = function* () {
			throw new Error("must not iterate every workspace panel while opening a file");
		};

		try {
			const filePanel = store.openFilePanel("src/instant.ts", "/tmp/project");

			expect(store.workspacePanels[0]).toBe(filePanel);
			expect(store.getFilePanel(filePanel.id)).toBe(filePanel);
			expect(store.getFilePanelByPath("src/instant.ts", "/tmp/project")).toBe(filePanel);
		} finally {
			store.workspacePanels[Symbol.iterator] = originalIterator;
		}
	});

	it("selects file panel count and path index without filtering workspace panels", () => {
		const store = createStore();
		const filePanel = store.openFilePanel("src/instant.ts", "/tmp/project");
		const originalFilter = store.workspacePanels.filter;

		store.workspacePanels.filter = () => {
			throw new Error("must not filter workspace panels for file-panel selectors");
		};

		try {
			expect(store.filePanelCount).toBe(1);
			expect(store.filePanels).toEqual([filePanel]);
			expect(store.filePanelByPath.get(createFilePanelCacheKey("src/instant.ts", "/tmp/project", null))).toBe(filePanel);
			expect(store.getFilePanelByPath("src/instant.ts", "/tmp/project")).toBe(filePanel);
		} finally {
			store.workspacePanels.filter = originalFilter;
		}
	});

	it("opens session panels without copying existing panel lists", () => {
		const store = createStore();
		store.spawnPanel({ projectPath: "/tmp/project" });
		const workspaceIterator = store.workspacePanels[Symbol.iterator];
		const agentPanels = store.getTopLevelAgentPanels();
		const agentIterator = agentPanels[Symbol.iterator];

		store.workspacePanels[Symbol.iterator] = function* () {
			throw new Error("must not iterate every workspace panel while opening a session");
		};
		agentPanels[Symbol.iterator] = function* () {
			throw new Error("must not iterate every agent panel while opening a session");
		};

		try {
			const panel = store.openSession("session-instant", 450);

			expect(panel).not.toBeNull();
			expect(store.workspacePanels[0]).toBe(panel);
			expect(store.getTopLevelAgentPanels()[0]).toBe(panel);
			expect(store.getPanelBySessionId("session-instant")).toBe(panel);
		} finally {
			store.workspacePanels[Symbol.iterator] = workspaceIterator;
			agentPanels[Symbol.iterator] = agentIterator;
		}
	});

	it("selects panels by session id without filtering agent panel lists", () => {
		const store = createStore();
		const panel = store.openSession("session-indexed", 450);
		const agentPanels = store.getTopLevelAgentPanels() as ReturnType<
			PanelStore["getTopLevelAgentPanels"]
		> & {
			filter: typeof Array.prototype.filter;
		};
		const originalFilter = agentPanels.filter;

		agentPanels.filter = () => {
			throw new Error("must not filter agent panels for session-id lookup");
		};

		try {
			expect(store.panelBySessionId.get("session-indexed")).toBe(panel);
			expect(store.getPanelBySessionId("session-indexed")).toBe(panel);
		} finally {
			agentPanels.filter = originalFilter;
		}
	});

	it("materializes background session panels without copying existing panel lists", () => {
		const store = createStore();
		const firstPanel = store.spawnPanel({ projectPath: "/tmp/project" });
		const workspaceIterator = store.workspacePanels[Symbol.iterator];
		const agentPanels = store.getTopLevelAgentPanels();
		const agentIterator = agentPanels[Symbol.iterator];

		store.workspacePanels[Symbol.iterator] = function* () {
			throw new Error("must not iterate every workspace panel while materializing a session");
		};
		agentPanels[Symbol.iterator] = function* () {
			throw new Error("must not iterate every agent panel while materializing a session");
		};

		try {
			const panel = store.materializeSessionPanel("session-background", 450);

			expect(panel).not.toBeNull();
			expect(store.workspacePanels[0]?.id).toBe(firstPanel.id);
			expect(store.workspacePanels[1]).toBe(panel);
			expect(store.getTopLevelAgentPanels()[0]?.id).toBe(firstPanel.id);
			expect(store.getTopLevelAgentPanels()[1]).toBe(panel);
		} finally {
			store.workspacePanels[Symbol.iterator] = workspaceIterator;
			agentPanels[Symbol.iterator] = agentIterator;
		}
	});

	it("promotes background session panels without filtering all workspace panels", () => {
		const store = createStore();
		const panel = store.materializeSessionPanel("session-promote", 450);
		expect(panel?.autoCreated).toBe(true);
		const originalFilter = store.workspacePanels.filter;

		store.workspacePanels.filter = () => {
			throw new Error("must not filter every workspace panel while promoting a session");
		};

		try {
			const promoted = store.openSession("session-promote", 450);

			expect(promoted?.autoCreated).toBe(false);
			expect(store.getPanelBySessionId("session-promote")?.autoCreated).toBe(false);
		} finally {
			store.workspacePanels.filter = originalFilter;
		}
	});

	it("opens file panels without copying existing project file-panel lists", () => {
		const store = createStore();
		const firstPanel = store.openFilePanel("src/first.ts", "/tmp/project");
		const projectPanels = store.getFilePanelsForProject("/tmp/project");
		const originalIterator = projectPanels[Symbol.iterator];

		projectPanels[Symbol.iterator] = function* () {
			throw new Error("must not copy existing project file panels while opening a file");
		};

		try {
			const secondPanel = store.openFilePanel("src/second.ts", "/tmp/project");

			expect(store.getFilePanelsForProject("/tmp/project")[0]).toBe(secondPanel);
			expect(store.getFilePanelsForProject("/tmp/project")[1]).toBe(firstPanel);
		} finally {
			projectPanels[Symbol.iterator] = originalIterator;
		}
	});

	it("opens attached file panels without copying existing owner file-panel lists", () => {
		const store = createStore();
		const owner = store.spawnPanel({ projectPath: "/tmp/project" });
		const firstPanel = store.openFilePanel("src/first.ts", "/tmp/project", {
			ownerPanelId: owner.id,
		});
		const ownerPanels = store.getAttachedFilePanels(owner.id);
		const originalIterator = ownerPanels[Symbol.iterator];

		ownerPanels[Symbol.iterator] = function* () {
			throw new Error("must not copy existing owner file panels while opening an attached file");
		};

		try {
			const secondPanel = store.openFilePanel("src/second.ts", "/tmp/project", {
				ownerPanelId: owner.id,
			});

			expect(store.getAttachedFilePanels(owner.id)[0]).toBe(secondPanel);
			expect(store.getAttachedFilePanels(owner.id)[1]).toBe(firstPanel);
		} finally {
			ownerPanels[Symbol.iterator] = originalIterator;
		}
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

	it("selects browser panels and count without filtering workspace panels", () => {
		const store = createStore();
		const browserPanel = store.openBrowserPanel("/tmp/project", "https://example.com", "Example");
		const originalFilter = store.workspacePanels.filter;

		store.workspacePanels.filter = () => {
			throw new Error("must not filter workspace panels for browser-panel selectors");
		};

		try {
			expect(store.browserPanelCount).toBe(1);
			expect(store.getBrowserPanel(browserPanel.id)).toBe(browserPanel);
			expect(store.getBrowserPanelsForProject("/tmp/project")).toEqual([browserPanel]);
		} finally {
			store.workspacePanels.filter = originalFilter;
		}
	});

	it("selects review panels and count without filtering workspace panels", () => {
		const store = createStore();
		const reviewPanel = store.openReviewPanel("/tmp/project", createModifiedFilesState());
		const originalFilter = store.workspacePanels.filter;

		store.workspacePanels.filter = () => {
			throw new Error("must not filter workspace panels for review-panel selectors");
		};

		try {
			expect(store.reviewPanelCount).toBe(1);
			expect(store.getReviewPanel(reviewPanel.id)).toBe(reviewPanel);
			expect(store.getReviewPanelByProjectPath("/tmp/project")).toBe(reviewPanel);
		} finally {
			store.workspacePanels.filter = originalFilter;
		}
	});

	it("selects restored git panels and count without filtering workspace panels", () => {
		const store = createStore();
		const gitPanel = {
			id: "git-1",
			kind: "git" as const,
			projectPath: "/tmp/project",
			width: 400,
			ownerPanelId: null,
		};
		store.restoreWorkspacePanels([gitPanel]);
		const originalFilter = store.workspacePanels.filter;

		store.workspacePanels.filter = () => {
			throw new Error("must not filter workspace panels for git-panel selectors");
		};

		try {
			expect(store.gitPanelCount).toBe(1);
			expect(store.gitPanelByProjectPath.get("/tmp/project")).toEqual(gitPanel);
		} finally {
			store.workspacePanels.filter = originalFilter;
		}
	});

	it("keeps terminal group indexes current across open, move, and close", () => {
		const store = createStore();
		const firstGroup = store.openTerminalPanel("/tmp/project");
		const otherGroup = store.openTerminalPanel("/tmp/other");
		const secondGroup = store.openTerminalPanel("/tmp/project");

		expect(store.getTerminalPanelGroup(firstGroup.id)).toEqual(firstGroup);
		expect(store.getTerminalPanelGroupsForProject("/tmp/project").map((group) => group.id)).toEqual([
			firstGroup.id,
			secondGroup.id,
		]);
		expect(store.getTerminalPanelGroupsForProject("/tmp/other").map((group) => group.id)).toEqual([
			otherGroup.id,
		]);

		const extraTab = store.openTerminalTab(firstGroup.id);
		expect(extraTab).not.toBeNull();

		const movedGroup = store.moveTerminalTabToNewPanel(extraTab!.id);
		expect(movedGroup).not.toBeNull();
		expect(store.getTerminalPanelGroup(movedGroup!.id)).toEqual(movedGroup);
		expect(store.getTerminalPanelGroupsForProject("/tmp/project").map((group) => group.id)).toEqual([
			firstGroup.id,
			movedGroup!.id,
			secondGroup.id,
		]);

		store.closeTerminalPanel(movedGroup!.id);
		expect(store.getTerminalPanelGroup(movedGroup!.id)).toBeUndefined();
		expect(store.getTerminalPanelGroupsForProject("/tmp/project").map((group) => group.id)).toEqual([
			firstGroup.id,
			secondGroup.id,
		]);
		expect(store.getTerminalPanelGroupsForProject("/tmp/missing")).toEqual([]);
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
