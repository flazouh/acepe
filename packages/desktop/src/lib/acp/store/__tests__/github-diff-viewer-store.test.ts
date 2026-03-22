import { describe, expect, it } from "vitest";

import { GitHubDiffViewerStore } from "../github-diff-viewer-store.svelte.js";

describe("GitHubDiffViewerStore", () => {
	it("opens with commit reference and project path", () => {
		const store = new GitHubDiffViewerStore();

		store.open({
			reference: { type: "commit", sha: "abc1234" },
			projectPath: "/workspace/project",
		});

		expect(store.opened).toBe(true);
		expect(store.reference).toEqual({ type: "commit", sha: "abc1234" });
		expect(store.projectPath).toBe("/workspace/project");
	});

	it("replaces previous state when opened again", () => {
		const store = new GitHubDiffViewerStore();

		store.open({
			reference: { type: "commit", sha: "abc1234" },
			projectPath: "/workspace/project-a",
		});
		store.open({
			reference: { type: "pr", owner: "acme", repo: "app", number: 42 },
			projectPath: "/workspace/project-b",
		});

		expect(store.opened).toBe(true);
		expect(store.reference).toEqual({ type: "pr", owner: "acme", repo: "app", number: 42 });
		expect(store.projectPath).toBe("/workspace/project-b");
	});

	it("closes and clears state", () => {
		const store = new GitHubDiffViewerStore();

		store.open({
			reference: { type: "commit", sha: "abc1234" },
			projectPath: "/workspace/project",
		});
		store.close();

		expect(store.opened).toBe(false);
		expect(store.reference).toBeNull();
		expect(store.projectPath).toBeNull();
	});
});
