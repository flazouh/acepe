import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileDiff as FileDiffType } from "../../../types/github-integration.js";

import PrDiffFileList from "../pr-diff-file-list.svelte";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("@acepe/ui", async () => {
	const FilePathBadge = (await import("./test-file-path-badge.svelte")).default;

	return {
		FilePathBadge,
	};
});

vi.mock("../../diff-viewer/pierre-diff-view.svelte", async () => {
	const PierreDiffView = (await import("./test-pierre-diff-view.svelte")).default;

	return {
		default: PierreDiffView,
	};
});

afterEach(() => {
	cleanup();
});

const files: FileDiffType[] = [
	{
		path: "src/routes/+page.svelte",
		status: "modified",
		additions: 4,
		deletions: 2,
		patch: "@@ -1 +1 @@\n-old\n+new",
	},
	{
		path: "src/lib/utils.ts",
		status: "modified",
		additions: 2,
		deletions: 1,
		patch: "@@ -1 +1 @@\n-old\n+new",
	},
];

describe("PrDiffFileList", () => {
	it("renders only file headers until a file is clicked", async () => {
		const view = render(PrDiffFileList, { files });

		expect(view.getByText("src/routes/+page.svelte")).not.toBeNull();
		expect(view.getByText("src/lib/utils.ts")).not.toBeNull();
		expect(view.queryAllByTestId("pierre-diff-stub")).toHaveLength(0);

		await fireEvent.click(view.getByRole("button", { name: "src/routes/+page.svelte" }));

		expect(view.getAllByTestId("pierre-diff-stub")).toHaveLength(1);
		expect(view.getByTestId("pierre-diff-stub").textContent).toContain("src/routes/+page.svelte");
	});

	it("collapses the current diff and switches to the next clicked file", async () => {
		const view = render(PrDiffFileList, { files });

		await fireEvent.click(view.getByRole("button", { name: "src/routes/+page.svelte" }));
		await fireEvent.click(view.getByRole("button", { name: "src/routes/+page.svelte" }));

		expect(view.queryAllByTestId("pierre-diff-stub")).toHaveLength(0);

		await fireEvent.click(view.getByRole("button", { name: "src/routes/+page.svelte" }));
		await fireEvent.click(view.getByRole("button", { name: "src/lib/utils.ts" }));

		expect(view.getAllByTestId("pierre-diff-stub")).toHaveLength(1);
		expect(view.getByTestId("pierre-diff-stub").textContent).toContain("src/lib/utils.ts");
	});

	it("uses a plain-text preview for large patches", async () => {
		const largeFiles: FileDiffType[] = [
			{
				path: "src/lib/huge.ts",
				status: "modified",
				additions: 1200,
				deletions: 1200,
				patch: `${"@@ -1 +1 @@\n-old\n+new\n".repeat(1200)}`,
			},
		];

		const view = render(PrDiffFileList, { files: largeFiles });

		await fireEvent.click(view.getByRole("button", { name: "src/lib/huge.ts" }));

		expect(view.queryAllByTestId("pierre-diff-stub")).toHaveLength(0);
		expect(view.getByTestId("plain-text-diff-preview")).not.toBeNull();
	});
});
