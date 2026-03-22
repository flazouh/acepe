import { cleanup, render, waitFor } from "@testing-library/svelte";
import { ok } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import DiffViewerModal from "./diff-viewer-modal.svelte";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("@acepe/ui", async () => {
	const GitViewer = (await import("./test-git-viewer.svelte")).default;
	const LoadingIcon = (await import("./test-loading-icon.svelte")).default;

	return {
		GitViewer,
		LoadingIcon,
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
	it("uses the embedded modal shell instead of an edge-to-edge fullscreen surface", async () => {
		const { container, getByTestId } = render(DiffViewerModal, {
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

		const overlay = container.querySelector("[aria-label='GitHub diff viewer']");
		expect(overlay?.className).toContain("bg-black/55");

		const panel = container.querySelector(".embedded-diff-viewer-modal");
		expect(panel?.className).toContain("rounded-[1.25rem]");
		expect(panel?.className).toContain("border-border/60");
	});
});
