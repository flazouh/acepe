import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import * as Effect from "effect/Effect";
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
	HugeiconsIcon: (await import("./pr-status-card/test-hugeicons-icon-stub.svelte")).default,
}));

vi.mock("$lib/utils/open-url.js", () => ({
	openUrl: vi.fn(),
}));

vi.mock("./messages/copy-button.svelte", async () => ({
	default: (await import("./pr-status-card/test-component-stub.svelte")).default,
}));

vi.mock("../hooks/use-session-context.js", () => ({
	useSessionContext: () => null,
}));

const fetchCommitDiffMock = vi.fn();
const fetchPrDiffMock = vi.fn();

vi.mock("../services/github-service.js", () => ({
	fetchCommitDiff: (...args: unknown[]) => fetchCommitDiffMock(...args),
	fetchPrDiff: (...args: unknown[]) => fetchPrDiffMock(...args),
}));

const { default: GitHubBadgeComponent } = await import("./github-badge.svelte");

describe("GitHubBadge", () => {
	beforeEach(() => {
		// github-service returns Effects, so the badge pipes the return
		// value straight into Effect.match -- a resolved Promise here would
		// blow up on `.pipe` before the assertion ever runs.
		fetchCommitDiffMock.mockReset();
		fetchCommitDiffMock.mockReturnValue(
			Effect.succeed({
				files: [{ additions: 7, deletions: 2 }],
			})
		);
		fetchPrDiffMock.mockReset();
		fetchPrDiffMock.mockReturnValue(
			Effect.succeed({
				pr: { state: "open" },
				files: [{ additions: 3, deletions: 1 }],
			})
		);
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
			expect(fetchPrDiffMock).toHaveBeenCalledWith("/repo", "flazouh", "acepe", 42);
		});
	});

	it("renders the external GitHub action with the open-in-new-window icon", () => {
		const view = render(GitHubBadgeComponent, {
			ref: { type: "commit", sha: "abcdef1", owner: "flazouh", repo: "acepe" },
			projectPath: "/repo",
		});

		const icon = view.getByTestId("github-badge-open-external-hugeicons-icon");
		expect(icon.getAttribute("data-hugeicons-icon-name")).toBe("open-in-new-window");
	});
});
