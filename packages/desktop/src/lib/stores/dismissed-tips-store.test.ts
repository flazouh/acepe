import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";

const getMock = mock((): Effect.Effect<string[] | null, Error> => Effect.succeed(null));
const setMock = mock((): Effect.Effect<void, Error> => Effect.succeed(undefined));

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
		getMock.mockReturnValue(Effect.succeed(null));
		setMock.mockReturnValue(Effect.succeed(undefined));
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
		getMock.mockReturnValue(Effect.succeed(["layout.view.info", "layout.tabbar.info"]));

		const store = new DismissedTipsStore();
		await store.initialize();

		expect(store.isDismissed("layout.view.info")).toBe(true);
		expect(store.isDismissed("layout.tabbar.info")).toBe(true);
	});

	it("handles load failures gracefully", async () => {
		getMock.mockReturnValue(Effect.fail(new Error("db error")));

		const store = new DismissedTipsStore();
		await store.initialize();

		expect(store.isDismissed("layout.view.info")).toBe(false);
	});
});
