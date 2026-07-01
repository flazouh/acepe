import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PrDetails } from "$lib/utils/tauri-client/git.js";

import PrStatusCard from "./pr-status-card.svelte";

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

vi.mock("@acepe/ui", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@acepe/ui")>();
	const Stub = (await import("./test-component-stub.svelte")).default;

	return {
		AgentPanelPrCard: actual.AgentPanelPrCard,
		DiffPill: Stub,
		GitHubBadge: Stub,
		LoadingIcon: Stub,
	};
});

vi.mock("../diff-viewer/diff-viewer-modal.svelte", async () => {
	const Stub = (await import("./test-component-stub.svelte")).default;

	return {
		default: Stub,
	};
});

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
			sessionId: "session-1",
			projectPath: "/repo",
			prNumber: prDetails.number,
			isCreating: false,
			prDetails,
			fetchError: null,
			linkedPr: null,
		});

		const header = container.querySelector("div[role='button'][tabindex='0']");
		expect(header).not.toBeNull();

		await fireEvent.click(header as HTMLElement);

		await waitFor(() => {
			const markdownRoot = container.querySelector(".markdown-content");
			expect(markdownRoot?.querySelector("h2")?.textContent).toBe("Summary");
			expect(markdownRoot?.querySelectorAll("li")).toHaveLength(2);
		});
	});

	it("keeps the PR action bar present with expanded content", async () => {
		const prDetails = {
			number: 91,
			title: "Move PR controls to the top",
			body: "## Summary\n- Header should stay first",
			state: "OPEN",
			url: "https://github.com/acepe/acepe/pull/91",
			isDraft: false,
			additions: 12,
			deletions: 4,
			commits: [],
		} satisfies PrDetails;

		const { container } = render(PrStatusCard, {
			sessionId: "session-1",
			projectPath: "/repo",
			prNumber: prDetails.number,
			isCreating: false,
			prDetails,
			fetchError: null,
			linkedPr: null,
		});

		const header = container.querySelector("div[role='button'][tabindex='0']");
		expect(header).not.toBeNull();

		await fireEvent.click(header as HTMLElement);

		await waitFor(() => {
			expect(container.querySelector(".markdown-content")).not.toBeNull();
		});
		const markdownRoot = container.querySelector(".markdown-content");
		expect(markdownRoot).not.toBeNull();
		expect(container.contains(header)).toBe(true);
		expect(
			header?.compareDocumentPosition(markdownRoot as Node) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
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
			sessionId: null,
			projectPath: "/repo",
			prNumber: null,
			isCreating: true,
			prDetails: null,
			fetchError: null,
			linkedPr: null,
			streamingData,
		});

		const header = view.container.querySelector("div[role='button'][tabindex='0']");
		expect(header).not.toBeNull();
		expect(view.container.querySelector(".markdown-content")).not.toBeNull();

		await fireEvent.click(header as HTMLElement);
		expect(view.container.querySelector(".markdown-content")).toBeNull();

		await view.rerender({
			sessionId: null,
			projectPath: "/repo",
			prNumber: null,
			isCreating: true,
			prDetails: null,
			fetchError: null,
			linkedPr: null,
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
