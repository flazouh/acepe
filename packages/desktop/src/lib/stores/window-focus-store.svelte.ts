/**
 * Window Focus Store - Tracks OS-level window focus state.
 *
 * Used to gate popup notifications: only show when the main window is unfocused.
 * Event-driven via Tauri's `onFocusChanged` — no polling.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { createLogger } from "$lib/acp/utils/logger.js";

const WINDOW_FOCUS_KEY = Symbol("window-focus");
const logger = createLogger({ id: "window-focus-store", name: "WindowFocusStore" });

export class WindowFocusStore {
	isFocused = $state(true);
	private unlisten: (() => void)[] = [];

	async initialize(): Promise<void> {
		const win = getCurrentWindow();

		const focused = await ResultAsync.fromPromise(
			win.isFocused(),
			(e) => new Error(`Failed to check focus: ${e}`)
		);
		if (focused.isOk()) {
			this.isFocused = focused.value;
		} else {
			logger.error("Failed to check initial focus state", { error: focused.error });
		}

		const listener = await ResultAsync.fromPromise(
			win.onFocusChanged(({ payload }) => {
				this.isFocused = payload;
			}),
			(e) => new Error(`Failed to listen focus: ${e}`)
		);
		if (listener.isOk()) {
			this.unlisten.push(listener.value);
		} else {
			logger.error("Failed to listen for focus changes", { error: listener.error });
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
