import { describe, expect, it } from "bun:test";
import type { BrowserPanel } from "$lib/acp/store/browser-panel-type.js";
import type { FilePanel } from "$lib/acp/store/file-panel-type.js";
import type { ReviewPanel } from "$lib/acp/store/review-panel-type.js";
import type { AgentWorkspacePanel, TerminalPanelGroup } from "$lib/acp/store/types.js";
import { resolvePanelsContainerFullscreenTarget } from "../panels-container-fullscreen-target.js";

function createAgentPanel(id = "agent-1"): AgentWorkspacePanel {
	return {
		id,
		kind: "agent",
		ownerPanelId: null,
		sessionId: null,
		width: 480,
		projectPath: "/repo",
		pendingProjectSelection: false,
		selectedAgentId: "codex",
		agentId: null,
		sessionTitle: null,
	};
}

function createFilePanel(id = "file-1", ownerPanelId: string | null = null): FilePanel {
	return {
		id,
		kind: "file",
		filePath: "src/app.ts",
		projectPath: "/repo",
		ownerPanelId,
		width: 500,
	};
}

function createReviewPanel(id = "review-1"): ReviewPanel {
	return {
		id,
		kind: "review",
		projectPath: "/repo",
		ownerPanelId: null,
		width: 600,
		modifiedFilesState: {
			files: [],
			byPath: new Map(),
			fileCount: 0,
			totalEditCount: 0,
		},
		selectedFileIndex: 0,
	};
}

function createTerminalPanel(id = "terminal-1"): TerminalPanelGroup {
	return {
		id,
		projectPath: "/repo",
		width: 500,
		selectedTabId: null,
		order: 0,
	};
}

function createBrowserPanel(id = "browser-1"): BrowserPanel {
	return {
		id,
		kind: "browser",
		projectPath: "/repo",
		url: "https://example.com",
		title: "Example",
		width: 500,
		ownerPanelId: null,
	};
}

describe("panels container fullscreen target", () => {
	it("returns null when there is no fullscreen panel", () => {
		expect(
			resolvePanelsContainerFullscreenTarget({
				fullscreenPanelId: null,
				topLevelPanel: undefined,
				filePanels: [],
				reviewPanels: [],
				terminalPanels: [],
				browserPanels: [],
			})
		).toBeNull();
	});

	it("resolves top-level agent panels through the workspace panel", () => {
		expect(
			resolvePanelsContainerFullscreenTarget({
				fullscreenPanelId: "agent-1",
				topLevelPanel: createAgentPanel(),
				filePanels: [],
				reviewPanels: [],
				terminalPanels: [],
				browserPanels: [],
			})
		).toEqual({ kind: "agent", panelId: "agent-1" });
	});

	it("resolves only top-level file panels", () => {
		const target = resolvePanelsContainerFullscreenTarget({
			fullscreenPanelId: "file-1",
			topLevelPanel: undefined,
			filePanels: [createFilePanel("file-1", null), createFilePanel("attached-file", "agent-1")],
			reviewPanels: [],
			terminalPanels: [],
			browserPanels: [],
		});

		expect(target?.kind).toBe("file");
		if (target?.kind === "file") {
			expect(target.panel.id).toBe("file-1");
		}
	});

	it("ignores attached file panels for fullscreen lookup", () => {
		expect(
			resolvePanelsContainerFullscreenTarget({
				fullscreenPanelId: "attached-file",
				topLevelPanel: undefined,
				filePanels: [createFilePanel("attached-file", "agent-1")],
				reviewPanels: [],
				terminalPanels: [],
				browserPanels: [],
			})
		).toBeNull();
	});

	it("resolves review, terminal, and browser panels", () => {
		expect(
			resolvePanelsContainerFullscreenTarget({
				fullscreenPanelId: "review-1",
				topLevelPanel: undefined,
				filePanels: [],
				reviewPanels: [createReviewPanel()],
				terminalPanels: [],
				browserPanels: [],
			})?.kind
		).toBe("review");
		expect(
			resolvePanelsContainerFullscreenTarget({
				fullscreenPanelId: "terminal-1",
				topLevelPanel: undefined,
				filePanels: [],
				reviewPanels: [],
				terminalPanels: [createTerminalPanel()],
				browserPanels: [],
			})?.kind
		).toBe("terminal");
		expect(
			resolvePanelsContainerFullscreenTarget({
				fullscreenPanelId: "browser-1",
				topLevelPanel: undefined,
				filePanels: [],
				reviewPanels: [],
				terminalPanels: [],
				browserPanels: [createBrowserPanel()],
			})?.kind
		).toBe("browser");
	});
});
