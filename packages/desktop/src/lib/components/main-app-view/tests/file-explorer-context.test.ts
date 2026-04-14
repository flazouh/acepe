import { describe, expect, it } from "bun:test";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import {
	buildFileExplorerProjectInfoByPath,
	buildFileExplorerProjectPaths,
} from "../logic/file-explorer-context.js";

function makeProject(path: string, name: string, color: string): Project {
	return {
		path,
		name,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		color,
		iconPath: `asset://${name.toLowerCase()}.png`,
	};
}

describe("file-explorer-context", () => {
	it("prefers the focused worktree path and excludes the source project duplicate", () => {
		const projects = [
			makeProject("/workspace/app", "App", "cyan"),
			makeProject("/workspace/other", "Other", "orange"),
		];

		const paths = buildFileExplorerProjectPaths(
			projects,
			"/workspace/app",
			"/workspace/app/.worktrees/feature-a"
		);

		expect(paths).toEqual(["/workspace/app/.worktrees/feature-a", "/workspace/other"]);
	});

	it("keeps the focused project first when no worktree is active", () => {
		const projects = [
			makeProject("/workspace/app", "App", "cyan"),
			makeProject("/workspace/other", "Other", "orange"),
			makeProject("/workspace/tools", "Tools", "green"),
		];

		const paths = buildFileExplorerProjectPaths(projects, "/workspace/other", null);

		expect(paths).toEqual(["/workspace/other", "/workspace/app", "/workspace/tools"]);
	});

	it("maps the focused worktree path to the owning project display info", () => {
		const projects = [makeProject("/workspace/app", "App", "cyan")];

		const info = buildFileExplorerProjectInfoByPath(
			projects,
			"/workspace/app",
			"/workspace/app/.worktrees/feature-a"
		);

		expect(info["/workspace/app/.worktrees/feature-a"]).toEqual({
			name: "App",
			color: "cyan",
			iconSrc: "asset://app.png",
		});
	});
});
