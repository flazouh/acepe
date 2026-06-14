import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	type TauriDragDropListen,
	TauriDragDropController,
} from "../tauri-drag-drop-controller.svelte.js";

function createPendingPromise<T>() {
	let resolveValue: ((value: T) => void) | null = null;
	const promise = new Promise<T>((resolve) => {
		resolveValue = resolve;
	});

	return {
		promise,
		resolve(value: T) {
			if (resolveValue !== null) {
				resolveValue(value);
			}
		},
	};
}

async function flushAsync(times = 10): Promise<void> {
	for (let index = 0; index < times; index += 1) {
		await Promise.resolve();
	}
}

describe("TauriDragDropController", () => {
	let listenMock: ReturnType<typeof vi.fn<TauriDragDropListen>>;

	beforeEach(() => {
		listenMock = vi.fn<TauriDragDropListen>();
	});

	it("invokes late unlisten when destroy happens before listen() resolves", async () => {
		const hoverRegistration = createPendingPromise<() => void>();
		const dropRegistration = createPendingPromise<() => void>();
		const leaveRegistration = createPendingPromise<() => void>();
		const unlistenHover = vi.fn();
		const unlistenDrop = vi.fn();
		const unlistenLeave = vi.fn();

		listenMock
			.mockReturnValueOnce(hoverRegistration.promise)
			.mockReturnValueOnce(dropRegistration.promise)
			.mockReturnValueOnce(leaveRegistration.promise);

		const controller = new TauriDragDropController({
			listen: listenMock,
			callbacks: {
				onDragOver: () => {},
				onDrop: () => {},
				onDragLeave: () => {},
			},
		});

		controller.start();

		hoverRegistration.resolve(unlistenHover);
		await flushAsync();

		controller.destroy();
		await flushAsync();

		expect(unlistenHover).toHaveBeenCalledTimes(1);

		dropRegistration.resolve(unlistenDrop);
		await flushAsync();

		leaveRegistration.resolve(unlistenLeave);
		await flushAsync();

		expect(unlistenDrop).toHaveBeenCalledTimes(1);
		expect(unlistenLeave).toHaveBeenCalledTimes(1);
	});

	it("does not crash when Tauri already removed drag-drop listeners during destroy", async () => {
		listenMock.mockImplementation(() =>
			Promise.resolve(async () => {
				throw new TypeError(
					"undefined is not an object (evaluating 'listeners[eventId].handlerId')"
				);
			})
		);

		const controller = new TauriDragDropController({
			listen: listenMock,
			callbacks: {
				onDragOver: () => {},
				onDrop: () => {},
				onDragLeave: () => {},
			},
		});

		controller.start();
		await flushAsync();

		expect(() => controller.destroy()).not.toThrow();
		await flushAsync();
	});

	it("uses the same minimal listen signature as the in-memory fake", () => {
		const fakeListen: TauriDragDropListen = async () => () => {};
		expect(typeof fakeListen).toBe("function");
		expect(typeof listenMock).toBe("function");
	});
});
