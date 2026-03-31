import { describe, expect, it, vi } from "vitest";

import { TabBarStore } from "../tab-bar-store.svelte.js";
import type { WorkspacePanel } from "../types.js";

function createStore(workspacePanels: WorkspacePanel[], focusedPanelId: string | null): TabBarStore {
	const panelStore = {
		workspacePanels,
		focusedPanelId,
	} as never;

	const sessionStore = {
		getSessionIdentity: vi.fn(() => null),
		getSessionMetadata: vi.fn(() => null),
		getHotState: vi.fn(() => null),
		getEntries: vi.fn(() => []),
	} as never;

	const questionStore = {
		pendingBySession: new Map(),
	} as never;

	const permissionStore = {
		pending: new Map(),
	} as never;

	const unseenStore = {
		isUnseen: vi.fn(() => false),
	} as never;

	return new TabBarStore(panelStore, sessionStore, questionStore, permissionStore, unseenStore);
}

describe("TabBarStore non-agent tabs", () => {
	it("includes top-level file, terminal, browser, review, and git panels without fabricating agent metadata", () => {
		const store = createStore(
			[
				{
					id: "file-1",
					kind: "file",
					projectPath: "/projects/acepe",
					ownerPanelId: null,
					width: 400,
					filePath: "src/lib/main.ts",
				},
				{
					id: "terminal-1",
					kind: "terminal",
					projectPath: "/projects/acepe",
					ownerPanelId: null,
					width: 420,
					groupId: "group-1",
				},
				{
					id: "browser-1",
					kind: "browser",
					projectPath: "/projects/acepe",
					ownerPanelId: null,
					width: 430,
					url: "https://example.com",
					title: "Example",
				},
				{
					id: "review-1",
					kind: "review",
					projectPath: "/projects/acepe",
					ownerPanelId: null,
					width: 440,
					modifiedFilesState: {
						files: [],
						byPath: new Map(),
						fileCount: 0,
						totalEditCount: 0,
					},
					selectedFileIndex: 0,
				},
				{
					id: "git-1",
					kind: "git",
					projectPath: "/projects/acepe",
					ownerPanelId: null,
					width: 450,
					initialTarget: { section: "prs", prNumber: 7 },
				},
			],
			"terminal-1"
		);

		store.setProjectColorLookup((projectPath) =>
			projectPath === "/projects/acepe" ? "#16DB95" : null
		);

		expect(store.tabs).toEqual([
			expect.objectContaining({
				panelId: "file-1",
				title: "main.ts",
				agentId: null,
				sessionId: null,
				isFocused: false,
				projectName: "acepe",
				projectColor: "#16DB95",
			}),
			expect.objectContaining({
				panelId: "terminal-1",
				title: "Terminal",
				isFocused: true,
				state: expect.objectContaining({
					connection: "disconnected",
					activity: { kind: "idle" },
				}),
			}),
			expect.objectContaining({
				panelId: "browser-1",
				title: "Example",
				agentId: null,
				sessionId: null,
				}),
				expect.objectContaining({
					panelId: "review-1",
					title: "Review",
					agentId: null,
					sessionId: null,
				}),
				expect.objectContaining({
					panelId: "git-1",
					title: "Source Control",
					agentId: null,
					sessionId: null,
			}),
		]);
	});

	it("excludes attached file panels from the top tab bar", () => {
		const store = createStore(
			[
				{
					id: "agent-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: null,
					width: 500,
					pendingProjectSelection: false,
					selectedAgentId: null,
					projectPath: "/projects/acepe",
					agentId: null,
					sessionTitle: null,
				},
				{
					id: "file-embedded",
					kind: "file",
					projectPath: "/projects/acepe",
					ownerPanelId: "agent-1",
					width: 400,
					filePath: "src/lib/hidden.ts",
				},
			],
			null
		);

		expect(store.tabs.map((tab) => tab.panelId)).toEqual(["agent-1"]);
	});
});
