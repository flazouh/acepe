import { describe, expect, it } from "bun:test";

import {
	hydratePersistedWorkspacePanels,
	serializeWorkspacePanels,
} from "../workspace-store.svelte.js";

describe("workspace panel persistence", () => {
	it("serializes supported workspace panel kinds except source control", () => {
		const persisted = serializeWorkspacePanels([
			{
				id: "agent-1",
				kind: "agent",
				projectPath: "/tmp/project",
				width: 450,
				ownerPanelId: null,
				sessionId: "session-1",
				autoCreated: undefined,
				pendingProjectSelection: false,
				pendingWorktreeEnabled: undefined,
				selectedAgentId: "claude-code",
				agentId: "claude-code",
				sourcePath: "/tmp/project/.cursor/sessions/session-1.json",
				worktreePath: "/tmp/project/.git/worktrees/feature-a",
				sessionTitle: "Thread",
				sequenceId: 5,
				preparedWorktreeLaunch: null,
			},
			{
				id: "file-1",
				kind: "file",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: "agent-1",
				filePath: "src/main.ts",
				targetLine: 12,
				targetColumn: 4,
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
				modifiedFilesState: {
					files: [],
					byPath: new Map(),
					fileCount: 0,
					totalEditCount: 0,
				},
				selectedFileIndex: 0,
			},
		]);

		expect(persisted).toEqual([
			{
				id: "agent-1",
				kind: "agent",
				projectPath: "/tmp/project",
				width: 450,
				ownerPanelId: null,
				sessionId: "session-1",
				autoCreated: undefined,
				pendingProjectSelection: false,
				pendingWorktreeEnabled: undefined,
				selectedAgentId: "claude-code",
				agentId: "claude-code",
				sourcePath: "/tmp/project/.cursor/sessions/session-1.json",
				worktreePath: "/tmp/project/.git/worktrees/feature-a",
				sessionTitle: "Thread",
				sequenceId: 5,
				preparedWorktreeLaunch: null,
			},
			{
				id: "file-1",
				kind: "file",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: "agent-1",
				filePath: "src/main.ts",
				targetLine: 12,
				targetColumn: 4,
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
		]);
	});

	it("hydrates runtime-only fields for terminal panels", () => {
		const panels = hydratePersistedWorkspacePanels([
			{
				id: "terminal-1",
				kind: "terminal",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: null,
				groupId: "group-1",
			},
		]);

		expect(panels).toEqual([
			{
				id: "terminal-1",
				kind: "terminal",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: null,
				groupId: "group-1",
			},
		]);
	});

	it("hydrates persisted worktree session context for agent panels", () => {
		const panels = hydratePersistedWorkspacePanels([
			{
				id: "agent-1",
				kind: "agent",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: null,
				sessionId: "session-1",
				pendingProjectSelection: false,
				selectedAgentId: "claude-code",
				agentId: "claude-code",
				sourcePath: "/tmp/project/.cursor/sessions/session-1.json",
				worktreePath: "/tmp/project/.git/worktrees/feature-a",
				sessionTitle: "Thread",
			},
		]);

		expect(panels).toEqual([
			{
				id: "agent-1",
				kind: "agent",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: null,
				sessionId: "session-1",
				autoCreated: undefined,
				pendingProjectSelection: false,
				pendingWorktreeEnabled: null,
				preparedWorktreeLaunch: null,
				selectedAgentId: "claude-code",
				agentId: "claude-code",
				sourcePath: "/tmp/project/.cursor/sessions/session-1.json",
				worktreePath: "/tmp/project/.git/worktrees/feature-a",
				sessionTitle: "Thread",
				sequenceId: null,
			},
		]);
	});

	it("ignores persisted source control panels during hydration", () => {
		const panels = hydratePersistedWorkspacePanels([
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
		]);

		expect(panels).toEqual([
			{
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
			},
		]);
	});

	it("round-trips pending worktree choice for fresh agent panels", () => {
		const persisted = serializeWorkspacePanels([
			{
				id: "agent-fresh",
				kind: "agent",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: null,
				sessionId: null,
				pendingProjectSelection: false,
				selectedAgentId: "claude-code",
				agentId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: null,
				pendingWorktreeEnabled: true,
			},
		]);

		expect(persisted).toEqual([
			{
				id: "agent-fresh",
				kind: "agent",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: null,
				sessionId: null,
				autoCreated: undefined,
				pendingProjectSelection: false,
				pendingWorktreeEnabled: true,
				preparedWorktreeLaunch: null,
				selectedAgentId: "claude-code",
				agentId: null,
				sourcePath: undefined,
				worktreePath: undefined,
				sessionTitle: undefined,
				sequenceId: undefined,
			},
		]);

		const panels = hydratePersistedWorkspacePanels(persisted);

		expect(panels).toEqual([
			{
				id: "agent-fresh",
				kind: "agent",
				projectPath: "/tmp/project",
				width: 500,
				ownerPanelId: null,
				sessionId: null,
				autoCreated: undefined,
				pendingProjectSelection: false,
				selectedAgentId: "claude-code",
				agentId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: null,
				sequenceId: null,
				pendingWorktreeEnabled: true,
				preparedWorktreeLaunch: null,
			},
		]);
	});
});
