import { describe, expect, it } from "bun:test";

import {
	groupAllPanelsByProject,
	groupWorkspacePanelsByProject,
	sortProjectGroupsForMultiLayout,
} from "./panel-grouping.js";

describe("groupAllPanelsByProject", () => {
	it("groups unified workspace panels by project and kind", () => {
		const groups = groupAllPanelsByProject(
			[
				{
					id: "agent-1",
					sessionProjectPath: "/tmp/project-a",
				},
			],
			[
				{
					id: "file-1",
					kind: "file",
					filePath: "src/main.ts",
					projectPath: "/tmp/project-a",
					ownerPanelId: null,
					width: 500,
				},
			],
			[],
			[
				{
					id: "terminal-1",
					projectPath: "/tmp/project-a",
					width: 500,
					selectedTabId: "tab-1",
					order: 0,
				},
			],
			[
				{
					id: "browser-1",
					kind: "browser",
					projectPath: "/tmp/project-a",
					ownerPanelId: null,
					width: 500,
					url: "https://example.com",
					title: "Example",
				},
			],
			[],
			[
				{
					path: "/tmp/project-a",
					name: "Project A",
					color: "#123456",
					createdAt: new Date(),
					iconPath: "/tmp/project-a/icon.png",
				},
			]
		);

		expect(groups).toHaveLength(1);
		expect(groups[0].projectPath).toBe("/tmp/project-a");
		expect(groups[0].projectIconSrc).toBe("/tmp/project-a/icon.png");
		expect(groups[0].agentPanels).toHaveLength(1);
		expect(groups[0].filePanels).toHaveLength(1);
		expect(groups[0].terminalPanels).toHaveLength(1);
		expect(groups[0].browserPanels).toHaveLength(1);
	});

	it("orders agent panels by descending project sequence within each project", () => {
		const groups = groupAllPanelsByProject(
			[
				{
					id: "agent-1",
					sessionProjectPath: "/tmp/project-a",
					sessionSequenceId: 1,
				},
				{
					id: "agent-4",
					sessionProjectPath: "/tmp/project-a",
					sessionSequenceId: 4,
				},
				{
					id: "agent-2",
					sessionProjectPath: "/tmp/project-a",
					sessionSequenceId: 2,
				},
			],
			[],
			[],
			[],
			[],
			[],
			[
				{
					path: "/tmp/project-a",
					name: "Project A",
					color: "#123456",
					createdAt: new Date(),
					iconPath: null,
				},
			]
		);

		expect(groups[0]?.agentPanels.map((panel) => panel.id)).toEqual([
			"agent-4",
			"agent-2",
			"agent-1",
		]);
	});

	it("keeps unsequenced agent panels after sequenced panels without changing their relative order", () => {
		const groups = groupAllPanelsByProject(
			[
				{
					id: "unsequenced-a",
					sessionProjectPath: "/tmp/project-a",
				},
				{
					id: "sequenced",
					sessionProjectPath: "/tmp/project-a",
					sessionSequenceId: 1,
				},
				{
					id: "unsequenced-b",
					sessionProjectPath: "/tmp/project-a",
					sessionSequenceId: null,
				},
			],
			[],
			[],
			[],
			[],
			[],
			[
				{
					path: "/tmp/project-a",
					name: "Project A",
					color: "#123456",
					createdAt: new Date(),
					iconPath: null,
				},
			]
		);

		expect(groups[0]?.agentPanels.map((panel) => panel.id)).toEqual([
			"sequenced",
			"unsequenced-a",
			"unsequenced-b",
		]);
	});

	it("keeps multiple terminal panel groups for one project", () => {
		const groups = groupAllPanelsByProject(
			[],
			[],
			[],
			[
				{
					id: "group-a",
					projectPath: "/tmp/project-a",
					width: 500,
					selectedTabId: "tab-a",
					order: 0,
				},
				{
					id: "group-b",
					projectPath: "/tmp/project-a",
					width: 520,
					selectedTabId: "tab-b",
					order: 1,
				},
			],
			[],
			[],
			[
				{
					path: "/tmp/project-a",
					name: "Project A",
					color: "#123456",
					createdAt: new Date(),
					iconPath: "/tmp/project-a/icon.png",
				},
			]
		);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.projectIconSrc).toBe("/tmp/project-a/icon.png");
		expect(groups[0]?.terminalPanels).toHaveLength(2);
		expect(groups[0]?.terminalPanels[0]?.id).toBe("group-a");
		expect(groups[0]?.terminalPanels[1]?.id).toBe("group-b");
	});
});

describe("sortProjectGroupsForMultiLayout", () => {
	function makeGroup(projectPath: string, projectName: string) {
		return {
			projectPath,
			projectName,
			projectColor: "#123456",
			projectIconSrc: null,
			agentPanels: [],
			filePanels: [],
			reviewPanels: [],
			terminalPanels: [],
			browserPanels: [],
			gitPanels: [],
		};
	}

	it("sorts groups alphabetically by resolved project name (case-insensitive)", () => {
		const sorted = sortProjectGroupsForMultiLayout([
			makeGroup("/tmp/zulu", "zulu"),
			makeGroup("/tmp/alpha", "Alpha"),
			makeGroup("/tmp/bravo", "bravo"),
		]);

		expect(sorted.map((g) => g.projectName)).toEqual(["Alpha", "bravo", "zulu"]);
	});

	it("uses project path as a stable tiebreaker when names match", () => {
		const sorted = sortProjectGroupsForMultiLayout([
			makeGroup("/tmp/b-alpha", "Alpha"),
			makeGroup("/tmp/a-alpha", "Alpha"),
		]);

		expect(sorted.map((g) => g.projectPath)).toEqual(["/tmp/a-alpha", "/tmp/b-alpha"]);
	});

	it("sorts groups with empty/unresolved project keys after named projects", () => {
		const sorted = sortProjectGroupsForMultiLayout([
			makeGroup("", ""),
			makeGroup("/tmp/bravo", "Bravo"),
			makeGroup("/tmp/alpha", "Alpha"),
		]);

		expect(sorted.map((g) => g.projectPath)).toEqual(["/tmp/alpha", "/tmp/bravo", ""]);
	});

	it("does not mutate the input array", () => {
		const input = [makeGroup("/tmp/zulu", "zulu"), makeGroup("/tmp/alpha", "Alpha")];
		const snapshot = input.map((g) => g.projectPath);
		sortProjectGroupsForMultiLayout(input);
		expect(input.map((g) => g.projectPath)).toEqual(snapshot);
	});
});

describe("groupWorkspacePanelsByProject", () => {
	it("groups unified non-agent workspace panels by project", () => {
		const groups = groupWorkspacePanelsByProject(
			[
				{
					id: "agent-1",
					projectPath: "/tmp/project-a",
				},
			],
			[
				{
					id: "file-1",
					kind: "file",
					filePath: "src/main.ts",
					projectPath: "/tmp/project-a",
					ownerPanelId: null,
					width: 500,
				},
				{
					id: "terminal-1",
					kind: "terminal",
					projectPath: "/tmp/project-a",
					ownerPanelId: null,
					width: 500,
					groupId: "group-1",
				},
				{
					id: "browser-1",
					kind: "browser",
					projectPath: "/tmp/project-a",
					ownerPanelId: null,
					width: 500,
					url: "https://example.com",
					title: "Example",
				},
				{
					id: "review-1",
					kind: "review",
					projectPath: "/tmp/project-a",
					ownerPanelId: null,
					width: 600,
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
					projectPath: "/tmp/project-a",
					ownerPanelId: null,
					width: 500,
					initialTarget: { section: "commits", commitSha: "abc123" },
				},
			],
			[],
			[],
			[
				{
					path: "/tmp/project-a",
					name: "Project A",
					color: "#123456",
					createdAt: new Date(),
					iconPath: "/tmp/project-a/icon.png",
				},
			]
		);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.projectIconSrc).toBe("/tmp/project-a/icon.png");
		expect(groups[0]?.agentPanels).toHaveLength(1);
		expect(groups[0]?.filePanels).toHaveLength(1);
		expect(groups[0]?.terminalPanels).toHaveLength(1);
		expect(groups[0]?.browserPanels).toHaveLength(1);
		expect(groups[0]?.reviewPanels).toHaveLength(1);
		expect(groups[0]?.gitPanels).toHaveLength(1);
	});
});
