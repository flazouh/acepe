import { cleanup, render, waitFor } from "@testing-library/svelte";
import { ok } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import DiffViewerModal from "./diff-viewer-modal.svelte";

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

vi.mock("@acepe/ui", async () => {
	const GitViewer = (await import("./test-git-viewer.svelte")).default;
	const LoadingIcon = (await import("./test-loading-icon.svelte")).default;
	const HugeiconsIcon = (await import("./test-hugeicons-icon.svelte")).default;

	return {
		GitViewer,
		getDialogHeaderIconCloseClass: () => "dialog-close-stub",
		LoadingIcon,
		HugeiconsIcon,
	};
});

vi.mock("../../services/github-service.js", () => ({
	fetchCommitDiff: vi.fn(() =>
		Promise.resolve(
			ok({
				sha: "abc1234",
				shortSha: "abc1234",
				message: "Test commit",
				messageBody: "",
				author: "Acepe",
				authorEmail: "acepe@example.com",
				date: "2026-03-12T00:00:00Z",
				files: [],
				repoContext: null,
			})
		)
	),
	fetchPrDiff: vi.fn(() =>
		Promise.resolve(
			ok({
				pr: {
					number: 42,
					title: "Test PR",
					author: "Acepe",
					state: "open",
					description: "",
				},
				files: [],
				repoContext: {
					owner: "acepe",
					repo: "desktop",
				},
			})
		)
	),
}));

afterEach(() => {
	cleanup();
});

describe("DiffViewerModal", () => {
	it("uses DialogFrame for a centered modal surface instead of edge-to-edge fullscreen", async () => {
		const { getByTestId } = render(DiffViewerModal, {
			open: true,
			reference: {
				type: "commit",
				sha: "abc1234",
			},
			projectPath: "/repo",
			onClose: vi.fn(),
		});

		await waitFor(() => {
			expect(getByTestId("git-viewer-stub")).not.toBeNull();
		});

		const dialogContent = document.querySelector("[data-slot='dialog-content']");
		expect(dialogContent).not.toBeNull();
		expect(dialogContent?.className).toContain("rounded-xl");

		const frameHeader = document.querySelector("[data-dialog-frame-header]");
		const frameTitle = document.querySelector("[data-dialog-frame-title]");
		const closeButton = document.querySelector("button[aria-label='Close diff viewer']");

		expect(frameHeader).not.toBeNull();
		expect(frameTitle?.textContent?.trim()).toBe("GitHub diff viewer");
		expect(closeButton).not.toBeNull();
		expect(frameHeader?.contains(closeButton)).toBe(true);
	});
});
