import { describe, expect, it, mock } from "bun:test";

import { WorkspaceStore } from "../workspace-store.svelte.js";
import type { WorkspacePanel } from "../types.js";

function createPanelStoreStub() {
	const panelStore = {
		workspacePanels: [] as WorkspacePanel[],
		panels: [],
		filePanels: [],
		terminalPanelGroups: [] as Array<{
			id: string;
			projectPath: string;
			width: number;
			selectedTabId: string | null;
			order: number;
		}>,
		terminalTabs: [] as Array<{
			id: string;
			groupId: string;
			projectPath: string;
			createdAt: number;
			ptyId: number | null;
			shell: string | null;
		}>,
		terminalPanels: [],
		browserPanels: [],
		reviewPanels: [],
		gitPanels: [],
		scrollX: 0,
		focusedPanelId: null as string | null,
		fullscreenPanelId: null as string | null,
		viewMode: "multi" as "single" | "project" | "multi",
		focusedViewProjectPath: null,
		embeddedTerminals: {
			serialize: mock(() => []),
			restore: mock(() => {}),
			getSelectedTabId: mock(() => null),
		},
		switchFullscreen: mock((panelId: string) => {
			panelStore.fullscreenPanelId = panelId;
		}),
		ensureSingleViewForAgentFullscreen: mock(() => {
			if (
				panelStore.fullscreenPanelId &&
				panelStore.workspacePanels.some(
					(panel: WorkspacePanel) =>
						panel.id === panelStore.fullscreenPanelId && panel.kind === "agent"
				)
			) {
				panelStore.viewMode = "single";
			}
		}),
		setActiveFilePanelMap: mock(() => {}),
		setPlanSidebarExpanded: mock(() => {}),
		setMessageDraft: mock(() => {}),
		setPendingReviewRestore: mock(() => {}),
		setEmbeddedTerminalDrawerOpen: mock(() => {}),
		getHotState: mock(() => ({
			planSidebarExpanded: true,
			messageDraft: "",
			reviewMode: false,
			reviewFileIndex: 0,
			embeddedTerminalDrawerOpen: false,
		})),
	};

	return panelStore;
}

describe("workspace fullscreen migration", () => {
	it("restores fullscreenPanelId from unified workspace panels", () => {
		const panelStore = createPanelStoreStub();
		const sessionStore = {
			getSessionIdentity: mock(() => undefined),
			getSessionMetadata: mock(() => undefined),
		};
		const store = new WorkspaceStore(panelStore as never, sessionStore as never);

		store.restore({
			version: 10,
			workspacePanels: [
				{
					id: "browser-1",
					kind: "browser",
					projectPath: "/tmp/project",
					ownerPanelId: null,
					width: 500,
					url: "https://example.com",
					title: "Example",
				},
			],
			panels: [],
			focusedPanelIndex: null,
			fullscreenPanelIndex: 0,
			panelContainerScrollX: 0,
			savedAt: new Date().toISOString(),
		});

		expect(panelStore.workspacePanels).toHaveLength(1);
		const restoredPanel = panelStore.workspacePanels.at(0);
		expect(restoredPanel).toBeDefined();
		if (!restoredPanel) {
			throw new Error("expected restored workspace panel");
		}
		expect(restoredPanel.kind).toBe("browser");
	});

	it("restores an agent fullscreen target as single view mode", () => {
		const panelStore = createPanelStoreStub();
		const sessionStore = {
			getSessionIdentity: mock(() => undefined),
			getSessionMetadata: mock(() => undefined),
		};
		const store = new WorkspaceStore(panelStore as never, sessionStore as never);

		store.restore({
			version: 10,
			workspacePanels: [
				{
					id: "agent-1",
					kind: "agent",
					projectPath: "/tmp/project",
					ownerPanelId: null,
					width: 500,
					sessionId: "session-1",
					pendingProjectSelection: false,
					selectedAgentId: null,
					agentId: null,
				},
			],
			panels: [],
			focusedPanelIndex: 0,
			fullscreenPanelIndex: 0,
			panelContainerScrollX: 0,
			savedAt: new Date().toISOString(),
			viewMode: "project",
		});

		expect(panelStore.fullscreenPanelId).toBe("agent-1");
		expect(panelStore.viewMode).toBe("single");
	});

	it("migrates legacy terminal panels into terminal groups and tabs", () => {
		const panelStore = createPanelStoreStub();
		const sessionStore = {
			getSessionIdentity: mock(() => undefined),
			getSessionMetadata: mock(() => undefined),
		};
		const store = new WorkspaceStore(panelStore as never, sessionStore as never);

		store.restore({
			version: 10,
			panels: [],
			focusedPanelIndex: 0,
			fullscreenPanelIndex: 1,
			panelContainerScrollX: 0,
			savedAt: new Date().toISOString(),
			terminalPanels: [
				{ id: "terminal-a", projectPath: "/tmp/project", width: 500 },
				{ id: "terminal-b", projectPath: "/tmp/project", width: 520 },
			],
		});

		expect(panelStore.terminalPanelGroups).toHaveLength(2);
		expect(panelStore.terminalTabs).toHaveLength(2);
		expect(panelStore.terminalPanelGroups[0]).toMatchObject({
			id: "terminal-a",
			projectPath: "/tmp/project",
			width: 500,
			order: 0,
		});
		expect(panelStore.terminalPanelGroups[1]).toMatchObject({
			id: "terminal-b",
			projectPath: "/tmp/project",
			width: 520,
			order: 1,
		});
		expect(panelStore.workspacePanels).toHaveLength(2);
		expect(panelStore.focusedPanelId).toBe("terminal-a");
		expect(panelStore.fullscreenPanelId).toBe("terminal-b");
	});
});
