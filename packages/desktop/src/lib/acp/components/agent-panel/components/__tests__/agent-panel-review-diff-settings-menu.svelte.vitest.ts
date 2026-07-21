import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_REVIEW_DIFF_OPTIONS } from "../../../modified-files/components/review-diff-view-state.svelte.js";
import AgentPanelReviewDiffSettingsMenu from "../agent-panel-review-diff-settings-menu.svelte";

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

afterEach(() => cleanup());

async function openMenu(): Promise<void> {
	await fireEvent.click(screen.getByTestId("review-dialog-diff-settings-trigger"));
	await screen.findByTestId("review-dialog-diff-settings-menu");
}

describe("AgentPanelReviewDiffSettingsMenu", () => {
	it("routes radio and checkbox selections without closing the menu", async () => {
		const onDiffStyleChange = vi.fn();
		const onDiffIndicatorStyleChange = vi.fn();
		const onDiffLineChangeStyleChange = vi.fn();
		const onDiffShowBackgroundsChange = vi.fn();
		const onDiffWrapLinesChange = vi.fn();
		const onDiffShowLineNumbersChange = vi.fn();

		render(AgentPanelReviewDiffSettingsMenu, {
			props: {
				diffStyle: "unified",
				diffOptions: DEFAULT_REVIEW_DIFF_OPTIONS,
				onDiffStyleChange,
				onDiffIndicatorStyleChange,
				onDiffLineChangeStyleChange,
				onDiffShowBackgroundsChange,
				onDiffWrapLinesChange,
				onDiffShowLineNumbersChange,
			},
		});

		await openMenu();
		await fireEvent.click(screen.getByTestId("review-dialog-diff-style-split"));
		await fireEvent.click(screen.getByTestId("review-dialog-diff-indicators-classic"));
		await fireEvent.click(screen.getByTestId("review-dialog-line-change-character"));
		await fireEvent.click(screen.getByTestId("review-dialog-toggle-backgrounds"));
		await fireEvent.click(screen.getByTestId("review-dialog-toggle-wrapping"));
		await fireEvent.click(screen.getByTestId("review-dialog-toggle-line-numbers"));

		expect(onDiffStyleChange).toHaveBeenCalledWith("split");
		expect(onDiffIndicatorStyleChange).toHaveBeenCalledWith("classic");
		expect(onDiffLineChangeStyleChange).toHaveBeenCalledWith("character");
		expect(onDiffShowBackgroundsChange).toHaveBeenCalledWith(false);
		expect(onDiffWrapLinesChange).toHaveBeenCalledWith(false);
		expect(onDiffShowLineNumbersChange).toHaveBeenCalledWith(false);

		await waitFor(() => {
			expect(screen.getByTestId("review-dialog-diff-settings-menu")).toBeTruthy();
		});
	});
});
