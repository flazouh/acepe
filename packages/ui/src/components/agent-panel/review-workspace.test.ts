import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getReviewWorkspaceDefaultIndex,
	resolveReviewWorkspaceSelectedIndex,
	type ReviewWorkspaceFileItem,
} from "./types.js";

function createFiles(): ReviewWorkspaceFileItem[] {
	return [
		{
			id: "file-1",
			filePath: "src/lib/alpha.ts",
			fileName: "alpha.ts",
			reviewStatus: "accepted",
			additions: 12,
			deletions: 2,
		},
		{
			id: "file-2",
			filePath: "src/lib/beta.ts",
			fileName: "beta.ts",
			reviewStatus: "unreviewed",
			additions: 3,
			deletions: 1,
		},
	];
}

describe("review-workspace selection helpers", () => {
	it("returns null when no files are available", () => {
		expect(getReviewWorkspaceDefaultIndex([])).toBeNull();
		expect(resolveReviewWorkspaceSelectedIndex([], null)).toBeNull();
	});

	it("prefers the first unreviewed file when selection is unset", () => {
		expect(getReviewWorkspaceDefaultIndex(createFiles())).toBe(1);
		expect(resolveReviewWorkspaceSelectedIndex(createFiles(), null)).toBe(1);
	});

	it("falls back to the first file when every file is already accepted", () => {
		const files = createFiles().map((file) => ({
			id: file.id,
			filePath: file.filePath,
			fileName: file.fileName,
			reviewStatus: "accepted" as const,
			additions: file.additions,
			deletions: file.deletions,
		}));

		expect(getReviewWorkspaceDefaultIndex(files)).toBe(0);
		expect(resolveReviewWorkspaceSelectedIndex(files, null)).toBe(0);
	});

	it("keeps an explicit valid selection", () => {
		expect(resolveReviewWorkspaceSelectedIndex(createFiles(), 0)).toBe(0);
	});

	it("falls back to the default selection when the requested index is invalid", () => {
		expect(resolveReviewWorkspaceSelectedIndex(createFiles(), -1)).toBe(1);
		expect(resolveReviewWorkspaceSelectedIndex(createFiles(), 99)).toBe(1);
	});
});

if (typeof document !== "undefined") {
	const EMPTY_STATE_LABEL = "Nothing to review";
	const HEADER_LABEL = "Review changes";

	function createContentSnippet(label: string) {
		return createRawSnippet(() => ({
			render: () => `<div data-testid="review-workspace-snippet">${label}</div>`,
		}));
	}

	describe("ReviewWorkspace", () => {
		beforeEach(() => {
			Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
				configurable: true,
				value: vi.fn(),
				writable: true,
			});
		});

		afterEach(() => {
			cleanup();
		});

		it("renders the two-pane layout with file list metadata and content area", async () => {
			const { default: ReviewWorkspace } = await import("./review-workspace.svelte");

			render(ReviewWorkspace, {
				files: createFiles(),
				selectedFileIndex: 1,
				headerLabel: HEADER_LABEL,
				emptyStateLabel: EMPTY_STATE_LABEL,
				content: createContentSnippet("Pierre diff"),
			});

			expect(screen.getByTestId("review-workspace-files-pane")).toBeTruthy();
			expect(screen.getByTestId("review-workspace-content-pane")).toBeTruthy();
			expect(screen.getByTestId("review-workspace-content-pane").className).toContain("flex-1");
			expect(screen.getByText("alpha.ts")).toBeTruthy();
			expect(screen.getByText("Reviewed")).toBeTruthy();
			expect(screen.getByText("Not reviewed")).toBeTruthy();
			expect(screen.getByTestId("review-workspace-snippet").textContent).toContain("Pierre diff");
		});

		it("calls onFileSelect with the clicked file index", async () => {
			const { default: ReviewWorkspace } = await import("./review-workspace.svelte");
			const onFileSelect = vi.fn();

			render(ReviewWorkspace, {
				files: createFiles(),
				selectedFileIndex: 0,
				headerLabel: HEADER_LABEL,
				emptyStateLabel: EMPTY_STATE_LABEL,
				content: createContentSnippet("Pierre diff"),
				onFileSelect,
			});

			const betaButton = screen.getByText("beta.ts").closest("button");
			expect(betaButton).toBeTruthy();

			await fireEvent.click(betaButton as HTMLButtonElement);

			expect(onFileSelect).toHaveBeenCalledWith(1);
		});

		it("highlights the selected file in the list", async () => {
			const { default: ReviewWorkspace } = await import("./review-workspace.svelte");

			render(ReviewWorkspace, {
				files: createFiles(),
				selectedFileIndex: 1,
				headerLabel: HEADER_LABEL,
				emptyStateLabel: EMPTY_STATE_LABEL,
				content: createContentSnippet("Pierre diff"),
			});

			const betaButton = screen.getByText("beta.ts").closest("button");
			expect(betaButton?.getAttribute("data-selected")).toBe("true");
		});

		it("calls onClose when the back button is pressed", async () => {
			const { default: ReviewWorkspace } = await import("./review-workspace.svelte");
			const onClose = vi.fn();

			render(ReviewWorkspace, {
				files: createFiles(),
				selectedFileIndex: 0,
				headerLabel: HEADER_LABEL,
				emptyStateLabel: EMPTY_STATE_LABEL,
				content: createContentSnippet("Pierre diff"),
				onClose,
			});

			await fireEvent.click(screen.getByTestId("review-workspace-close"));

			expect(onClose).toHaveBeenCalledTimes(1);
		});

		it("renders the empty state in both panes when no files are available", async () => {
			const { default: ReviewWorkspace } = await import("./review-workspace.svelte");

			render(ReviewWorkspace, {
				files: [],
				headerLabel: HEADER_LABEL,
				emptyStateLabel: EMPTY_STATE_LABEL,
			});

			expect(screen.getAllByText(EMPTY_STATE_LABEL)).toHaveLength(2);
			expect(screen.getByTestId("review-workspace-content-empty")).toBeTruthy();
		});

		it("auto-selects the single file on mount when no selection is provided", async () => {
			const { default: ReviewWorkspace } = await import("./review-workspace.svelte");
			const onFileSelect = vi.fn();

			render(ReviewWorkspace, {
				files: [
					{
						id: "file-1",
						filePath: "src/lib/solo.ts",
						fileName: "solo.ts",
						reviewStatus: "unreviewed",
						additions: 1,
						deletions: 0,
					},
				],
				headerLabel: HEADER_LABEL,
				emptyStateLabel: EMPTY_STATE_LABEL,
				content: createContentSnippet("Pierre diff"),
				onFileSelect,
			});

			await waitFor(() => {
				expect(onFileSelect).toHaveBeenCalledWith(0);
			});
		});
	});
}
