import { beforeEach, describe, expect, it, mock } from "bun:test";

interface MockResult {
	isOk: () => boolean;
	isErr: () => boolean;
	value: string[] | null;
	error: Error | null;
}

function okResult(value: string[] | null): MockResult {
	return { isOk: () => true, isErr: () => false, value, error: null };
}

function errResult(error: Error): MockResult {
	return { isOk: () => false, isErr: () => true, value: null, error };
}

const getMock = mock(async (): Promise<MockResult> => okResult(null));
const setMock = mock(() => ({ mapErr: () => ({}) }));

mock.module("svelte", () => ({
	getContext: mock(() => {
		throw new Error("getContext not implemented in test");
	}),
	setContext: mock(() => {}),
}));

mock.module("$lib/acp/utils/logger.js", () => ({
	createLogger: () => ({
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	}),
}));

mock.module("$lib/utils/tauri-client.js", () => ({
	openFileInEditor: mock(() => undefined),
	revealInFinder: mock(() => undefined),
	tauriClient: {
		settings: {
			get: getMock,
			set: setMock,
		},
	},
}));

import { DismissedTipsStore } from "./dismissed-tips-store.svelte.js";

describe("dismissed-tips-store", () => {
	beforeEach(() => {
		getMock.mockReset();
		setMock.mockClear();
		getMock.mockResolvedValue(okResult(null));
		setMock.mockReturnValue({ mapErr: () => ({}) });
	});

	it("returns false for unknown keys", () => {
		const store = new DismissedTipsStore();
		expect(store.isDismissed("layout.view.info")).toBe(false);
	});

	it("marks a key dismissed and persists it", () => {
		const store = new DismissedTipsStore();
		store.dismiss("layout.view.info");
		expect(store.isDismissed("layout.view.info")).toBe(true);
		expect(setMock).toHaveBeenCalledWith("dismissed_tooltips", ["layout.view.info"]);
	});

	it("does not duplicate dismissed keys", () => {
		const store = new DismissedTipsStore();
		store.dismiss("layout.view.info");
		setMock.mockClear();
		store.dismiss("layout.view.info");
		expect(setMock).not.toHaveBeenCalled();
	});

	it("loads persisted keys", async () => {
		getMock.mockResolvedValue(okResult(["layout.view.info", "layout.tabbar.info"]));

		const store = new DismissedTipsStore();
		await store.initialize();

		expect(store.isDismissed("layout.view.info")).toBe(true);
		expect(store.isDismissed("layout.tabbar.info")).toBe(true);
	});

	it("handles load failures gracefully", async () => {
		getMock.mockResolvedValue(errResult(new Error("db error")));

		const store = new DismissedTipsStore();
		await store.initialize();

		expect(store.isDismissed("layout.view.info")).toBe(false);
	});
});
