import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PrDetails } from "$lib/utils/tauri-client/git.js";

import PrStatusCard from "./pr-status-card.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(dirname(require.resolve("svelte/package.json")), "src/index-client.js");

	return import(/* @vite-ignore */ svelteClientPath);
});

vi.mock("@acepe/ui", async () => {
	const Stub = (await import("./test-component-stub.svelte")).default;

	return {
		DiffPill: Stub,
		GitHubBadge: Stub,
		LoadingIcon: Stub,
	};
});

vi.mock("phosphor-svelte/lib/GitMerge", async () => {
	const Stub = (await import("./test-component-stub.svelte")).default;

	return {
		default: Stub,
	};
});

vi.mock("phosphor-svelte/lib/GitPullRequest", async () => {
	const Stub = (await import("./test-component-stub.svelte")).default;

	return {
		default: Stub,
	};
});


vi.mock("../diff-viewer/diff-viewer-modal.svelte", async () => {
	const Stub = (await import("./test-component-stub.svelte")).default;

	return {
		default: Stub,
	};
});

vi.mock("../../utils/markdown-renderer.js", () => ({
	renderMarkdownSync: vi.fn(() => ({
		html: "<h2>Summary</h2><ul><li>First item</li><li>Second item</li></ul><hr>",
		fromCache: false,
		needsAsync: false,
	})),
}));

afterEach(() => {
	cleanup();
});

describe("PrStatusCard", () => {
	it("renders PR description inside the shared markdown-content wrapper", async () => {
		const prDetails = {
			number: 90,
			title: "Refine session item badge spacing",
			body: "## Summary\n- First item\n- Second item",
			state: "OPEN",
			url: "https://github.com/acepe/acepe/pull/90",
			isDraft: false,
			additions: 158,
			deletions: 29,
			commits: [],
		} satisfies PrDetails;

		const { container } = render(PrStatusCard, {
			projectPath: "/repo",
			prNumber: prDetails.number,
			isCreating: false,
			prDetails,
			fetchError: null,
		});

		const header = container.querySelector("div[role='button'][tabindex='0']");
		expect(header).not.toBeNull();

		await fireEvent.click(header as HTMLElement);

		const markdownRoot = container.querySelector(".markdown-content");
		expect(markdownRoot).not.toBeNull();
		expect(markdownRoot?.querySelector("h2")?.textContent).toBe("Summary");
		expect(markdownRoot?.querySelectorAll("li")).toHaveLength(2);
	});

	it("keeps streamed content collapsed after the user closes the card", async () => {
		const streamingData = {
			commitMessage: null,
			prTitle: "Streaming title",
			prDescription: "## Summary\n- First item",
			activeField: "pr-description",
			started: true,
			complete: false,
		} as const;

		const view = render(PrStatusCard, {
			projectPath: "/repo",
			prNumber: null,
			isCreating: true,
			prDetails: null,
			fetchError: null,
			streamingData,
		});

		const header = view.container.querySelector("div[role='button'][tabindex='0']");
		expect(header).not.toBeNull();
		expect(view.container.querySelector(".markdown-content")).not.toBeNull();

		await fireEvent.click(header as HTMLElement);
		expect(view.container.querySelector(".markdown-content")).toBeNull();

		await view.rerender({
			projectPath: "/repo",
			prNumber: null,
			isCreating: true,
			prDetails: null,
			fetchError: null,
			streamingData: {
				commitMessage: null,
				prTitle: "Streaming title",
				prDescription: "## Summary\n- First item\n- Second item",
				activeField: "pr-description",
				started: true,
				complete: false,
			},
		});

		expect(view.container.querySelector(".markdown-content")).toBeNull();
	});
});
