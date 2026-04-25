import { beforeEach, describe, expect, it, mock } from "bun:test";

interface MockGetResult {
	isOk: () => boolean;
	value: boolean | null;
}

const getMock = mock(async (): Promise<MockGetResult> => ({ isOk: () => true, value: null }));
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

import { AttentionQueueStore } from "./attention-queue-store.svelte.js";

describe("attention-queue-store", () => {
	beforeEach(() => {
		getMock.mockReset();
		setMock.mockClear();
		getMock.mockResolvedValue({ isOk: () => true, value: null });
		setMock.mockReturnValue({ mapErr: () => ({}) });
	});

	it("defaults to enabled when no preference is stored", async () => {
		const store = new AttentionQueueStore();

		await store.initialize();

		expect(store.enabled).toBe(true);
	});

	it("loads a persisted disabled preference", async () => {
		getMock.mockResolvedValue({ isOk: () => true, value: false });
		const store = new AttentionQueueStore();

		await store.initialize();

		expect(store.enabled).toBe(false);
	});
});
