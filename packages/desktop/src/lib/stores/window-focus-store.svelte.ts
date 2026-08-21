/**
 * Window Focus Store - Tracks OS-level window focus state.
 *
 * Used to gate popup notifications: only show when the main window is unfocused.
 * Event-driven via Tauri's `onFocusChanged` — no polling.
 */

import { fromPromise } from "@acepe/effect-result/fromPromise";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { getContext, setContext } from "svelte";
import { createLogger } from "$lib/acp/utils/logger.js";

const WINDOW_FOCUS_KEY = Symbol("window-focus");
const logger = createLogger({ id: "window-focus-store", name: "WindowFocusStore" });

export class WindowFocusStore {
	isFocused = $state(true);
	private unlisten: (() => void)[] = [];

	async initialize(): Promise<void> {
		const win = getCurrentWindow();

		const focused = await Effect.runPromise(
			Effect.result(
				fromPromise(
					() => win.isFocused(),
					(e) => new Error(`Failed to check focus: ${e}`)
				)
			)
		);
		if (Result.isSuccess(focused)) {
			this.isFocused = focused.success;
		} else {
			logger.error("Failed to check initial focus state", { error: focused.failure });
		}

		const listener = await Effect.runPromise(
			Effect.result(
				fromPromise(
					() =>
						win.onFocusChanged(({ payload }) => {
							this.isFocused = payload;
						}),
					(e) => new Error(`Failed to listen focus: ${e}`)
				)
			)
		);
		if (Result.isSuccess(listener)) {
			this.unlisten.push(listener.success);
		} else {
			logger.error("Failed to listen for focus changes", { error: listener.failure });
		}
	}

	cleanup(): void {
		this.unlisten.forEach((fn) => fn());
		this.unlisten = [];
	}
}

export function createWindowFocusStore(): WindowFocusStore {
	const store = new WindowFocusStore();
	setContext(WINDOW_FOCUS_KEY, store);
	return store;
}

export function getWindowFocusStore(): WindowFocusStore {
	return getContext<WindowFocusStore>(WINDOW_FOCUS_KEY);
}
