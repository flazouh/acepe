import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import FilePanelHeader from "../file-panel-header.svelte";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../../node_modules/svelte/src/index-client.js")
);

afterEach(() => {
	cleanup();
});

describe("FilePanelHeader project-header style", () => {
	it("keeps segmented mode toggles and close behavior", async () => {
		const onClose = vi.fn();
		const onDisplayModeChange = vi.fn();

		const { getByText, container } = render(FilePanelHeader, {
			fileName: "README.md",
			filePath: "README.md",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			content: "# hello",
			gitStatus: null,
			compact: false,
			hideProjectBadge: true,
			displayModes: ["raw", "structured"],
			activeDisplayMode: "raw",
			onDisplayModeChange,
			editorModes: [],
			activeEditorMode: "write",
			onEditorModeChange: undefined,
			onClose,
		});

		const structuredToggle = getByText("Tree");
		await fireEvent.click(structuredToggle);
		expect(onDisplayModeChange).toHaveBeenCalledWith("structured");
		const structuredToggleButton = structuredToggle.closest("button");
		expect(structuredToggleButton).not.toBeNull();
		expect(structuredToggleButton?.className).toContain("h-7");

		const close = container.querySelector(`button[title='${"Close"}']`);
		expect(close).not.toBeNull();
		expect(close?.className).toContain("h-7");
		if (close) {
			await fireEvent.click(close);
		}
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
