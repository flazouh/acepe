import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ReviewWorkspace from "./review-workspace.svelte";
import type { ReviewWorkspaceFileItem } from "./types.js";

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

function createContentSnippet(label: string) {
	return createRawSnippet(() => ({
		render: () => `<div data-testid="review-workspace-snippet">${label}</div>`,
	}));
}

function createHeaderActionsSnippet() {
	return createRawSnippet(() => ({
		render: () => `<button type="button" data-testid="review-workspace-diff-style">Split</button>`,
	}));
}

describe("ReviewWorkspace file navigation", () => {
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

	it("shows top-right file progress and navigates to the next file", async () => {
		const onFileSelect = vi.fn();

		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 0,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			onFileSelect,
		});

		expect(screen.getByTestId("review-workspace-file-position").textContent).toBe("1/2");

		await fireEvent.click(screen.getByTestId("review-workspace-next-file"));

		expect(onFileSelect).toHaveBeenCalledWith(1);
	});

	it("navigates to the previous file from the top-right review controls", async () => {
		const onFileSelect = vi.fn();

		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 1,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			onFileSelect,
		});

		await fireEvent.click(screen.getByTestId("review-workspace-previous-file"));

		expect(onFileSelect).toHaveBeenCalledWith(0);
	});

	it("can show file navigation without the back button for modal review", async () => {
		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 0,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			showCloseButton: false,
			onFileSelect: vi.fn(),
		});

		expect(screen.queryByTestId("review-workspace-close")).toBeNull();
		expect(screen.getByTestId("review-workspace-file-position").textContent).toBe("1/2");
		expect(screen.getByTestId("review-workspace-next-file").textContent).toContain("Next");
	});

	it("uses the keep action instead of file navigation when provided", async () => {
		const onKeepFile = vi.fn();
		const onFileSelect = vi.fn();

		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 0,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			showCloseButton: false,
			onKeepFile,
			onFileSelect,
		});

		expect(screen.getByTestId("review-workspace-next-file").textContent).toContain("Keep");

		await fireEvent.click(screen.getByTestId("review-workspace-next-file"));

		expect(onKeepFile).toHaveBeenCalledTimes(1);
		expect(onFileSelect).not.toHaveBeenCalled();
	});

	it("places the review toolbar inside the content pane instead of above the files", async () => {
		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 0,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			showCloseButton: false,
			onFileSelect: vi.fn(),
		});

		const header = screen.getByTestId("review-workspace-header");
		const contentPane = screen.getByTestId("review-workspace-content-pane");
		const codeSurface = screen.getByTestId("review-workspace-content");
		const body = screen.getByTestId("review-workspace-body");

		expect(contentPane.contains(header)).toBe(true);
		expect(codeSurface.contains(header)).toBe(true);
		expect(body.firstElementChild?.getAttribute("data-testid")).toBe("review-workspace-files-pane");
		expect(header.className).not.toContain("rounded");
		expect(header.className).not.toContain("bg-input");
		expect(header.className).not.toContain("border-b");
		expect(contentPane.className).not.toContain("bg-background");
	});

	it("does not render a review title or icon in the modal toolbar", async () => {
		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 0,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			showCloseButton: false,
			onFileSelect: vi.fn(),
		});

		expect(screen.queryByTestId("review-workspace-title")).toBeNull();
		expect(screen.queryByText("Review changes")).toBeNull();
	});

	it("renders optional header actions next to file navigation", async () => {
		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 0,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			headerActions: createHeaderActionsSnippet(),
			showCloseButton: false,
			onFileSelect: vi.fn(),
		});

		const actions = screen.getByTestId("review-workspace-header-actions");

		expect(actions.contains(screen.getByTestId("review-workspace-diff-style"))).toBe(true);
		expect(screen.getByTestId("review-workspace-file-position").textContent).toBe("1/2");
	});

	it("keeps only the code diff as the visible right-side card", async () => {
		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 0,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			showCloseButton: false,
			onFileSelect: vi.fn(),
		});

		const contentPane = screen.getByTestId("review-workspace-content-pane");
		const codeSurface = screen.getByTestId("review-workspace-content");
		const codeCard = screen.getByTestId("review-workspace-code-card");
		const codeScrollShell = screen.getByTestId("review-workspace-code-scroll-shell");

		expect(contentPane.className).not.toContain("bg-background");
		expect(codeSurface.className).not.toContain("rounded");
		expect(codeSurface.className).not.toContain("border");
		expect(codeSurface.className).not.toContain("bg-input/30");
		expect(codeSurface.className).not.toContain("m-1");
		expect(codeSurface.className).not.toContain("m-2");
		expect(codeSurface.className).toContain("p-");
		expect(codeCard.className).toContain("rounded");
		expect(codeCard.className).toContain("border");
		expect(codeCard.className).toContain("bg-input/30");
		expect(codeScrollShell.className).toContain("min-h-0");
		expect(codeScrollShell.className).toContain("overflow-hidden");
	});

	it("matches the left file card styling for the code diff card", async () => {
		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 0,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			showCloseButton: false,
			onFileSelect: vi.fn(),
		});

		const filesPane = screen.getByTestId("review-workspace-files-pane");
		const codeCard = screen.getByTestId("review-workspace-code-card");

		for (const className of ["rounded", "border", "border-border", "bg-input/30"]) {
			expect(filesPane.className).toContain(className);
			expect(codeCard.className).toContain(className);
		}
	});

	it("keeps both cards bounded so their children can scroll", async () => {
		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 0,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			showCloseButton: false,
			onFileSelect: vi.fn(),
		});

		const filesPane = screen.getByTestId("review-workspace-files-pane");
		const fileListScroll = screen.getByTestId("review-workspace-file-list-scroll");
		const codeSurface = screen.getByTestId("review-workspace-content");
		const codeCard = screen.getByTestId("review-workspace-code-card");
		const codeScrollShell = screen.getByTestId("review-workspace-code-scroll-shell");

		for (const element of [filesPane, codeSurface, codeCard, codeScrollShell]) {
			expect(element.className).toContain("min-h-0");
			expect(element.className).toContain("overflow-hidden");
		}

		expect(fileListScroll.className).toContain("min-h-0");
		expect(fileListScroll.className).toContain("overflow-y-auto");
		expect(codeSurface.className).toContain("p-");
		expect(codeSurface.className).not.toContain("bg-input/30");
		expect(codeCard.className).toContain("bg-input/30");
		expect(codeCard.className).not.toContain("m-1");
		expect(codeCard.className).not.toContain("m-2");
	});

	it("aligns the file card and code card when the header is hidden", async () => {
		render(ReviewWorkspace, {
			files: createFiles(),
			selectedFileIndex: 0,
			headerLabel: "Review changes",
			emptyStateLabel: "Nothing to review",
			content: createContentSnippet("Pierre diff"),
			showHeader: false,
			showCloseButton: false,
			onFileSelect: vi.fn(),
		});

		const codeSurface = screen.getByTestId("review-workspace-content");
		const codeCard = screen.getByTestId("review-workspace-code-card");

		expect(codeSurface.classList.contains("p-1")).toBe(false);
		expect(codeSurface.classList.contains("p-2")).toBe(false);
		expect(codeCard.className).toContain("rounded");
		expect(codeCard.className).toContain("border");
	});
});
