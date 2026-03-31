import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function browserWebviewResult() {
	return {
		match: (onOk: () => void) => {
			onOk();
			return undefined;
		},
	};
}

const browserWebviewMock = {
	open: vi.fn(() => browserWebviewResult()),
	close: vi.fn(() => browserWebviewResult()),
	resize: vi.fn(() => browserWebviewResult()),
	setZoom: vi.fn(() => browserWebviewResult()),
	navigate: vi.fn(() => browserWebviewResult()),
	back: vi.fn(() => browserWebviewResult()),
	forward: vi.fn(() => browserWebviewResult()),
	reload: vi.fn(() => browserWebviewResult()),
};

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("$lib/utils/tauri-client/browser-webview.js", () => ({
	browserWebview: browserWebviewMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		innerPosition: async () => ({ x: 0, y: 0 }),
		scaleFactor: async () => 1,
	}),
}));

vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({
		position: async () => ({ x: 0, y: 0 }),
	}),
}));

vi.mock("$lib/services/zoom.svelte.js", () => ({
	getZoomService: () => ({
		zoomLevel: 1,
	}),
}));

vi.mock("../browser-panel-header.svelte", async () => ({
	default: (await import("./fixtures/browser-panel-header-close-stub.svelte")).default,
}));

import BrowserPanel from "../browser-panel.svelte";

class TestResizeObserver {
	observe(_target: Element): void {}
	disconnect(): void {}
}

type QueuedAnimationFrame = {
	id: number;
	callback: FrameRequestCallback;
};

let queuedAnimationFrames: QueuedAnimationFrame[] = [];
let nextAnimationFrameId = 1;

async function flushAnimationFrames(): Promise<void> {
	const queued = [...queuedAnimationFrames];
	queuedAnimationFrames = [];
	for (const frame of queued) {
		frame.callback(0);
	}
	await tick();
}

describe("BrowserPanel close behavior", () => {
	beforeEach(() => {
		browserWebviewMock.open.mockClear();
		browserWebviewMock.close.mockClear();
		browserWebviewMock.resize.mockClear();
		browserWebviewMock.navigate.mockClear();
		browserWebviewMock.setZoom?.mockClear?.();
		queuedAnimationFrames = [];
		nextAnimationFrameId = 1;
		vi.stubGlobal("ResizeObserver", TestResizeObserver);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
			const id = nextAnimationFrameId;
			nextAnimationFrameId += 1;
			queuedAnimationFrames.push({ id, callback });
			return id;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
			queuedAnimationFrames = queuedAnimationFrames.filter((frame) => frame.id !== id);
		});
	});

	afterEach(() => {
		cleanup();
		queuedAnimationFrames = [];
		vi.unstubAllGlobals();
	});

	it("closes the native webview immediately when the header close action fires", async () => {
		const onClose = vi.fn();
		const view = render(BrowserPanel, {
			panelId: "embedded-browser-panel-1",
			url: "https://www.google.com",
			title: "Browser",
			width: 500,
			isFillContainer: true,
			onClose,
			onResize: () => {},
		});

		await flushAnimationFrames();
		await flushAnimationFrames();

		const closeButton = view.container.querySelector("button[title='Close browser panel']");
		expect(closeButton).not.toBeNull();

		if (!closeButton) {
			throw new Error("Expected close button");
		}

		await fireEvent.click(closeButton);

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(browserWebviewMock.close).toHaveBeenCalledWith("browser-embedded-browser-panel-1");
	});
});
