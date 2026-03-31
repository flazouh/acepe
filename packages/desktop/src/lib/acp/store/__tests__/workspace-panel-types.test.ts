import { describe, expect, it } from "bun:test";

import type {
	AgentWorkspacePanel,
	BrowserWorkspacePanel,
	FileWorkspacePanel,
	GitWorkspacePanel,
	PersistedAgentWorkspacePanelState,
	PersistedBrowserWorkspacePanelState,
	PersistedFileWorkspacePanelState,
	PersistedGitWorkspacePanelState,
	PersistedReviewWorkspacePanelState,
	PersistedTerminalWorkspacePanelState,
	ReviewWorkspacePanel,
	TerminalWorkspacePanel,
	WorkspacePanel,
} from "../types.js";

describe("workspace panel types", () => {
	it("supports discriminated workspace panel variants", () => {
		const agentPanel: AgentWorkspacePanel = {
			id: "agent-1",
			kind: "agent",
			projectPath: "/tmp/project",
			width: 450,
			ownerPanelId: null,
			sessionId: "session-1",
			pendingProjectSelection: false,
			selectedAgentId: "claude-code",
			agentId: "claude-code",
			sourcePath: "/tmp/project/.cursor/sessions/session-1.json",
			worktreePath: "/tmp/project/.git/worktrees/feature-a",
			sessionTitle: "Thread",
		};

		const filePanel: FileWorkspacePanel = {
			id: "file-1",
			kind: "file",
			projectPath: "/tmp/project",
			width: 500,
			ownerPanelId: "agent-1",
			filePath: "src/main.ts",
			targetLine: 42,
			targetColumn: 7,
		};

		const terminalPanel: TerminalWorkspacePanel = {
			id: "terminal-1",
			kind: "terminal",
			projectPath: "/tmp/project",
			width: 500,
			ownerPanelId: null,
			groupId: "group-1",
		};

		const browserPanel: BrowserWorkspacePanel = {
			id: "browser-1",
			kind: "browser",
			projectPath: "/tmp/project",
			width: 500,
			ownerPanelId: null,
			url: "https://example.com",
			title: "Example",
		};

		const reviewPanel: ReviewWorkspacePanel = {
			id: "review-1",
			kind: "review",
			projectPath: "/tmp/project",
			width: 600,
			ownerPanelId: null,
			modifiedFilesState: {
				files: [],
				byPath: new Map(),
				fileCount: 0,
				totalEditCount: 0,
			},
			selectedFileIndex: 0,
		};

		const gitPanel: GitWorkspacePanel = {
			id: "git-1",
			kind: "git",
			projectPath: "/tmp/project",
			width: 500,
			ownerPanelId: null,
			initialTarget: { section: "prs", prNumber: 42 },
		};

		const panels: WorkspacePanel[] = [
			agentPanel,
			filePanel,
			terminalPanel,
			browserPanel,
			reviewPanel,
			gitPanel,
		];

		expect(panels.map((panel) => panel.kind)).toEqual([
			"agent",
			"file",
			"terminal",
			"browser",
			"review",
			"git",
		]);
		expect(filePanel.ownerPanelId).toBe("agent-1");
		expect(terminalPanel.ownerPanelId).toBeNull();
		expect(reviewPanel.ownerPanelId).toBeNull();
		expect(gitPanel.ownerPanelId).toBeNull();
	});

	it("supports persisted workspace panel variants", () => {
		const persistedPanels: [
			PersistedAgentWorkspacePanelState,
			PersistedFileWorkspacePanelState,
			PersistedTerminalWorkspacePanelState,
			PersistedBrowserWorkspacePanelState,
			PersistedReviewWorkspacePanelState,
			PersistedGitWorkspacePanelState,
		] = [
			{
				id: "agent-1",
				kind: "agent",
				projectPath: "/tmp/project",
				width: 450,
				ownerPanelId: null,
				sessionId: "session-1",
				pendingProjectSelection: false,
				selectedAgentId: "claude-code",
				agentId: "claude-code",
				sourcePath: "/tmp/project/.cursor/sessions/session-1.json",
				worktreePath: "/tmp/project/.git/worktrees/feature-a",
				sessionTitle: "Thread",
			},
			{
				id: "file-1",
				kind: "file",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: "agent-1",
				filePath: "src/main.ts",
				targetLine: 42,
				targetColumn: 7,
			},
			{
				id: "terminal-1",
				kind: "terminal",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: null,
				groupId: "group-1",
			},
			{
				id: "browser-1",
				kind: "browser",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: null,
				url: "https://example.com",
				title: "Example",
			},
			{
				id: "review-1",
				kind: "review",
				projectPath: "/tmp/project",
				width: 600,
				ownerPanelId: null,
				files: [],
				totalEditCount: 0,
				selectedFileIndex: 0,
			},
			{
				id: "git-1",
				kind: "git",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: null,
				initialTarget: { section: "prs", prNumber: 42 },
			},
		];

		expect(persistedPanels.map((panel) => panel.kind)).toEqual([
			"agent",
			"file",
			"terminal",
			"browser",
			"review",
			"git",
		]);
	});
});
