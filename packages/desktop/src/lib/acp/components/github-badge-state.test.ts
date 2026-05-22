import { describe, expect, it } from "bun:test";
import {
	enhanceGitHubReference,
	getGitHubBadgeCopyText,
	getGitHubDiffStats,
	getGitHubStatsKey,
	shouldLoadGitHubStats,
} from "./github-badge-state.js";

describe("github badge state", () => {
	it("enhances bare commit refs with repo context", () => {
		expect(
			enhanceGitHubReference(
				{ type: "commit", sha: "abc123" },
				{ owner: "flazouh", repo: "acepe" }
			)
		).toEqual({
			type: "commit",
			sha: "abc123",
			owner: "flazouh",
			repo: "acepe",
		});
	});

	it("keeps refs unchanged when no enhancement is needed", () => {
		const prRef = { type: "pr" as const, owner: "flazouh", repo: "acepe", number: 42 };

		expect(enhanceGitHubReference(prRef, { owner: "other", repo: "repo" })).toBe(prRef);
		expect(enhanceGitHubReference({ type: "commit", sha: "abc123" }, undefined)).toEqual({
			type: "commit",
			sha: "abc123",
		});
	});

	it("builds stable stats keys", () => {
		expect(
			getGitHubStatsKey({
				ref: { type: "commit", sha: "abc123" },
				projectPath: "/repo",
			})
		).toBe("commit:/repo:abc123");
		expect(
			getGitHubStatsKey({
				ref: { type: "pr", owner: "flazouh", repo: "acepe", number: 42 },
				projectPath: "/repo",
			})
		).toBe("pr:/repo:flazouh/acepe#42");
		expect(
			getGitHubStatsKey({
				ref: { type: "issue", owner: "flazouh", repo: "acepe", number: 7 },
				projectPath: undefined,
			})
		).toBe("issue:flazouh/acepe#7");
	});

	it("loads stats only for unloaded commit or PR refs with project path", () => {
		expect(
			shouldLoadGitHubStats({
				ref: { type: "commit", sha: "abc123" },
				hasLoadedStats: false,
				statsLoading: false,
				projectPath: "/repo",
			})
		).toBe(true);
		expect(
			shouldLoadGitHubStats({
				ref: { type: "issue", owner: "flazouh", repo: "acepe", number: 7 },
				hasLoadedStats: false,
				statsLoading: false,
				projectPath: "/repo",
			})
		).toBe(false);
		expect(
			shouldLoadGitHubStats({
				ref: { type: "commit", sha: "abc123" },
				hasLoadedStats: true,
				statsLoading: false,
				projectPath: "/repo",
			})
		).toBe(false);
		expect(
			shouldLoadGitHubStats({
				ref: { type: "commit", sha: "abc123" },
				hasLoadedStats: false,
				statsLoading: false,
				projectPath: undefined,
			})
		).toBe(false);
	});

	it("sums diff stats", () => {
		expect(
			getGitHubDiffStats([
				{ additions: 3, deletions: 1 },
				{ additions: 4, deletions: 2 },
			])
		).toEqual({ insertions: 7, deletions: 3 });
	});

	it("builds copy text for refs", () => {
		expect(getGitHubBadgeCopyText({ type: "commit", sha: "abc123" })).toBe("abc123");
		expect(getGitHubBadgeCopyText({ type: "pr", owner: "flazouh", repo: "acepe", number: 42 })).toBe(
			"flazouh/acepe#42"
		);
		expect(
			getGitHubBadgeCopyText({ type: "issue", owner: "flazouh", repo: "acepe", number: 7 })
		).toBe("flazouh/acepe#7");
	});
});
