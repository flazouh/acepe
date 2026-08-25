/**
 * Window Focus Store - Tracks OS-level window focus state.
 *
 * Used to gate popup notifications: only show when the main window is unfocused.
 * Event-driven via Tauri's `onFocusChanged` — no polling.
 */

import { getContext, setContext } from "svelte";
import { createLogger } from "$lib/acp/utils/logger.js";

const WINDOW_FOCUS_KEY = Symbol("window-focus");
const logger = createLogger({ id: "window-focus-store", name: "WindowFocusStore" });

export class WindowFocusStore {
	isFocused = $state(true);
	private unlisten: (() => void)[] = [];

	async initialize(): Promise<void> {
		if (typeof window === "undefined") {
			return;
		}
		this.isFocused = document.hasFocus();
		const onFocus = (): void => {
			this.isFocused = true;
		};
		const onBlur = (): void => {
			this.isFocused = false;
		};
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		this.unlisten.push(() => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
		});
		logger.info("WindowFocusStore.initialize uses document focus events");
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
