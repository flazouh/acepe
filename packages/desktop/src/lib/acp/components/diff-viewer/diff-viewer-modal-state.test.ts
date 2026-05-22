import { describe, expect, it } from "bun:test";
import type { CommitDiff, FileDiff, PrDiff, RepoContext } from "../../types/github-integration.js";
import { buildDiffViewerData, mapDiffFilesToGitViewerFiles } from "./diff-viewer-modal-state.js";

const repoContext: RepoContext = {
	owner: "acme",
	repo: "app",
	remoteUrl: "https://github.com/acme/app",
};

const fileDiff: FileDiff = {
	path: "src/app.ts",
	status: "modified",
	additions: 3,
	deletions: 1,
	patch: "@@ patch",
};

function createCommitDiff(overrides: Partial<CommitDiff> = {}): CommitDiff {
	return {
		sha: "abcdef123456",
		shortSha: "abcdef1",
		message: "Update app",
		messageBody: "Body",
		author: "Alex",
		authorEmail: "alex@example.com",
		date: "2026-01-01T00:00:00Z",
		files: [fileDiff],
		repoContext,
		...overrides,
	};
}

function createPrDiff(overrides: Partial<PrDiff> = {}): PrDiff {
	return {
		pr: {
			number: 42,
			title: "Improve app",
			author: "alex",
			state: "open",
			description: "PR body",
		},
		files: [fileDiff],
		repoContext,
		...overrides,
	};
}

describe("diff viewer modal state", () => {
	it("maps backend files to shared viewer files", () => {
		expect(mapDiffFilesToGitViewerFiles([fileDiff])).toEqual([
			{
				path: "src/app.ts",
				status: "modified",
				additions: 3,
				deletions: 1,
				patch: "@@ patch",
			},
		]);
	});

	it("builds commit viewer data", () => {
		expect(buildDiffViewerData(createCommitDiff())).toEqual({
			type: "commit",
			commit: {
				sha: "abcdef123456",
				shortSha: "abcdef1",
				message: "Update app",
				messageBody: "Body",
				author: "Alex",
				authorEmail: "alex@example.com",
				date: "2026-01-01T00:00:00Z",
				files: mapDiffFilesToGitViewerFiles([fileDiff]),
				githubUrl: "https://github.com/acme/app/commit/abcdef123456",
			},
		});
	});

	it("builds PR viewer data", () => {
		expect(buildDiffViewerData(createPrDiff())).toEqual({
			type: "pr",
			pr: {
				number: 42,
				title: "Improve app",
				author: "alex",
				state: "open",
				description: "PR body",
				files: mapDiffFilesToGitViewerFiles([fileDiff]),
				githubUrl: "https://github.com/acme/app/pull/42",
			},
		});
	});

	it("returns null when no diff is loaded", () => {
		expect(buildDiffViewerData(null)).toBeNull();
	});
});
