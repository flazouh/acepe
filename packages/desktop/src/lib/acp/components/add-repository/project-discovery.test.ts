import { describe, expect, it } from "bun:test";

import type { ProjectWithSessions } from "./open-project-dialog-props.js";
import { shouldShowDiscoveredProject, sortProjectsBySessionCount } from "./project-discovery.js";

function makeProject(
	name: string,
	totalSessions: number | "loading" | "error"
): ProjectWithSessions {
	return {
		path: `/Users/alex/Documents/${name}`,
		name,
		agentCounts: new Map(),
		totalSessions,
	};
}

describe("shouldShowDiscoveredProject", () => {
	it("hides worktree entries flagged by the backend", () => {
		expect(
			shouldShowDiscoveredProject({
				path: "/Users/alex/Documents/project",
				agent_id: "claude-code",
				is_worktree: true,
			})
		).toBe(false);
	});

	it("hides acepe-managed worktree paths even when backend metadata is stale", () => {
		expect(
			shouldShowDiscoveredProject({
				path: "/Users/alex/.acepe/worktrees/6d4131f5197e/proud-canyon",
				agent_id: "claude-code",
				is_worktree: false,
			})
		).toBe(false);
	});

	it("hides projects nested inside hidden directories", () => {
		expect(
			shouldShowDiscoveredProject({
				path: "/Users/alex/.codecs/acepe-scratch",
				agent_id: "codex",
				is_worktree: false,
			})
		).toBe(false);
	});

	it("keeps main project roots discoverable", () => {
		expect(
			shouldShowDiscoveredProject({
				path: "/Users/alex/Documents/acepe",
				agent_id: "claude-code",
				is_worktree: false,
			})
		).toBe(true);
	});

	it("sorts projects by session count with incomplete counts last", () => {
		expect(
			sortProjectsBySessionCount([
				makeProject("loading", "loading"),
				makeProject("medium", 3),
				makeProject("high", 9),
				makeProject("error", "error"),
				makeProject("low", 1),
			]).map((project) => project.name)
		).toEqual(["high", "medium", "low", "loading", "error"]);
	});
});
