import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import GitPrHeader from "../git-viewer/git-pr-header.svelte";
import type { GitCommitData, GitPrData } from "../git-viewer/types.js";
import GitCommitHeader from "../git-viewer/git-commit-header.svelte";
import KanbanScenePrFooter from "../kanban/kanban-scene-pr-footer.svelte";
import PrChecksList from "../pr-checks/pr-checks-list.svelte";
import MergeButton from "./merge-button.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
});

function expectHugeiconsIcon(icon: Element): void {
	expect(icon.tagName.toLowerCase()).toBe("svg");
	expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
	expect(icon.innerHTML).not.toBe("");
}

describe("MergeButton Hugeicons wiring", () => {
	it("renders the merged state with the Hugeicons PR status icon", () => {
		const { container, getByText } = render(MergeButton, {
			props: { mergeState: "merged" },
		});

		expect(getByText("Merged")).toBeTruthy();
		expectHugeiconsIcon(container.querySelector("svg") as Element);
		expect(container.querySelector("svg")?.getAttribute("class")).toContain("size-[11px]");
	});

	it("renders merged PR headers with the Hugeicons PR status icon", () => {
		const pr: GitPrData = {
			number: 42,
			title: "Land Hugeicons",
			author: "alex",
			state: "merged",
			files: [],
		};

		const { container, getByText } = render(GitPrHeader, { props: { pr } });

		expect(getByText("Merged")).toBeTruthy();
		expectHugeiconsIcon(container.querySelector("svg") as Element);
	});

	it("renders PR external navigation with a Hugeicons icon", () => {
		const pr: GitPrData = {
			number: 42,
			title: "Land Hugeicons",
			author: "alex",
			state: "open",
			files: [],
			githubUrl: "https://github.com/flazouh/acepe/pull/42",
		};

		const { getByTestId } = render(GitPrHeader, {
			props: { pr, onViewOnGitHub: vi.fn() },
		});

		expectHugeiconsIcon(getByTestId("git-pr-header-open-external-hugeicons-icon"));
	});

	it("renders commit external navigation with a Hugeicons icon", () => {
		const commit: GitCommitData = {
			sha: "abc123456789",
			shortSha: "abc1234",
			message: "Land Hugeicons",
			author: "alex",
			date: "2026-07-12",
			files: [],
			githubUrl: "https://github.com/flazouh/acepe/commit/abc123456789",
		};

		const { getByTestId } = render(GitCommitHeader, {
			props: { commit, onViewOnGitHub: vi.fn() },
		});

		expectHugeiconsIcon(getByTestId("git-commit-header-open-external-hugeicons-icon"));
	});

	it("renders commit SHA copy with the shared Hugeicons Copy icon", () => {
		const commit: GitCommitData = {
			sha: "abc123456789",
			shortSha: "abc1234",
			message: "Land Hugeicons copy icons",
			author: "alex",
			date: "2026-07-12",
			files: [],
			githubUrl: undefined,
		};

		const { getByTestId } = render(GitCommitHeader, {
			props: { commit, onViewOnGitHub: vi.fn() },
		});

		expectHugeiconsIcon(getByTestId("git-commit-header-copy-sha-hugeicons-icon"));
	});

	it("renders Kanban PR footer external navigation with a Hugeicons icon", () => {
		const { getByTestId } = render(KanbanScenePrFooter, {
			props: {
				prNumber: 42,
				prState: "OPEN",
				title: "Land Hugeicons",
				url: "https://github.com/flazouh/acepe/pull/42",
				additions: 12,
				deletions: 3,
				isLoading: false,
				hasResolvedDetails: true,
				checks: [],
				isChecksLoading: false,
				hasResolvedChecks: true,
				onOpen: vi.fn(),
				onOpenExternal: vi.fn(),
			},
		});

		expectHugeiconsIcon(getByTestId("kanban-pr-footer-open-external-hugeicons-icon"));
	});

	it("renders PR checks external navigation with a Hugeicons icon", () => {
		const { getByTestId } = render(PrChecksList, {
			props: {
				checks: [
					{
						name: "CI",
						status: "COMPLETED",
						conclusion: "SUCCESS",
						detailsUrl: "https://github.com/flazouh/acepe/actions/runs/1",
						startedAt: null,
						completedAt: null,
						workflowName: "CI",
					},
				],
				hasResolved: true,
				initiallyExpanded: true,
				onOpenCheck: vi.fn(),
			},
		});

		expectHugeiconsIcon(getByTestId("pr-checks-list-open-external-hugeicons-icon"));
	});
});
