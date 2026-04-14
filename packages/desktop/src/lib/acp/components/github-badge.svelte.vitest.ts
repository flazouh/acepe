import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

vi.mock("@acepe/ui", async () => ({
	GitHubBadge: (await import("./__tests__/fixtures/github-badge-stub.svelte")).default,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn(),
}));

vi.mock("phosphor-svelte/lib/GithubLogo", async () => ({
	default: (await import("./pr-status-card/test-component-stub.svelte")).default,
}));

vi.mock("./messages/copy-button.svelte", async () => ({
	default: (await import("./pr-status-card/test-component-stub.svelte")).default,
}));

vi.mock("../hooks/use-session-context.js", () => ({
	useSessionContext: () => null,
}));

const openGitDialogMock = vi.fn();
const fetchCommitDiffMock = vi.fn();
const fetchPrDiffMock = vi.fn();

vi.mock("../store/panel-store.svelte.js", () => ({
	getPanelStore: () => ({
		openGitDialog: openGitDialogMock,
	}),
}));

vi.mock("../services/github-service.js", () => ({
	fetchCommitDiff: (...args: unknown[]) => fetchCommitDiffMock(...args),
	fetchPrDiff: (...args: unknown[]) => fetchPrDiffMock(...args),
}));

const { default: GitHubBadgeComponent } = await import("./github-badge.svelte");

describe("GitHubBadge", () => {
	beforeEach(() => {
		openGitDialogMock.mockClear();
		fetchCommitDiffMock.mockReset();
		fetchCommitDiffMock.mockResolvedValue({
			match: (
				onOk: (diff: { files: Array<{ additions?: number; deletions?: number }> }) => void
			) => {
				onOk({
					files: [{ additions: 7, deletions: 2 }],
				});
			},
		});
		fetchPrDiffMock.mockReset();
		fetchPrDiffMock.mockResolvedValue({
			match: (
				onOk: (diff: {
					pr: { state: "open" };
					files: Array<{ additions?: number; deletions?: number }>;
				}) => void
			) => {
				onOk({
					pr: { state: "open" },
					files: [{ additions: 3, deletions: 1 }],
				});
			},
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("loads commit stats lazily on first hover instead of mount", async () => {
		const view = render(GitHubBadgeComponent, {
			ref: { type: "commit", sha: "abcdef1", owner: "flazouh", repo: "acepe" },
			projectPath: "/repo",
		});

		const hoverTarget = view.container.firstElementChild;
		if (!(hoverTarget instanceof HTMLElement)) {
			throw new Error("Expected wrapper element");
		}

		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(fetchCommitDiffMock).not.toHaveBeenCalled();

		await fireEvent.mouseEnter(hoverTarget);

		await waitFor(() => {
			expect(fetchCommitDiffMock).toHaveBeenCalledWith("abcdef1", "/repo");
		});

		await fireEvent.mouseEnter(hoverTarget);
		expect(fetchCommitDiffMock).toHaveBeenCalledTimes(1);
	});

	it("loads pr stats on mount without requiring hover", async () => {
		render(GitHubBadgeComponent, {
			ref: { type: "pr", owner: "flazouh", repo: "acepe", number: 42 },
			projectPath: "/repo",
		});

		await waitFor(() => {
			expect(fetchPrDiffMock).toHaveBeenCalledWith("flazouh", "acepe", 42);
		});
	});
});
