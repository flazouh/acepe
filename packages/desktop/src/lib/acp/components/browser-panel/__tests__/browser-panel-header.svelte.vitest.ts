import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

const openUrlMock = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: openUrlMock,
}));

import BrowserPanelHeader from "../browser-panel-header.svelte";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../../node_modules/svelte/src/index-client.js")
);

afterEach(() => {
	cleanup();
});

describe("BrowserPanelHeader", () => {
	it("fires navigation and action callbacks", async () => {
		openUrlMock.mockReset();
		openUrlMock.mockResolvedValue(undefined);
		const onBack = vi.fn();
		const onForward = vi.fn();
		const onReload = vi.fn();
		const onNavigate = vi.fn();
		const onOpenExternal = vi.fn(async () => {
			await openUrlMock("https://example.com/path");
		});
		const onClose = vi.fn();

		const { container } = render(BrowserPanelHeader, {
			url: "https://example.com/path",
			onBack,
			onForward,
			onReload,
			onNavigate,
			onOpenExternal,
			onClose,
		});

		const urlInput = container.querySelector("input[name='browser-url']");

		const back = container.querySelector(`button[title='${"Go back"}']`);
		const forward = container.querySelector(`button[title='${"Go forward"}']`);
		const reload = container.querySelector(`button[title='${"Refresh"}']`);
		const openExternal = container.querySelector(`button[title='${"Open in browser"}']`);
		const close = container.querySelector(`button[title='${"Close"}']`);

		expect(urlInput).not.toBeNull();
		expect(back).not.toBeNull();
		expect(forward).not.toBeNull();
		expect(reload).not.toBeNull();
		expect(openExternal).not.toBeNull();
		expect(close).not.toBeNull();

		if (urlInput) {
			await fireEvent.input(urlInput, { target: { value: "https://news.ycombinator.com" } });
			const form = urlInput.closest("form");
			if (form) {
				await fireEvent.submit(form);
			}
		}
		if (back) await fireEvent.click(back);
		if (forward) await fireEvent.click(forward);
		if (reload) await fireEvent.click(reload);
		if (openExternal) await fireEvent.click(openExternal);
		if (close) await fireEvent.click(close);

		expect(onNavigate).toHaveBeenCalledWith("https://news.ycombinator.com");
		expect(onBack).toHaveBeenCalledTimes(1);
		expect(onForward).toHaveBeenCalledTimes(1);
		expect(onReload).toHaveBeenCalledTimes(1);
		expect(onOpenExternal).toHaveBeenCalledTimes(1);
		expect(openUrlMock).toHaveBeenCalledWith("https://example.com/path");
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
