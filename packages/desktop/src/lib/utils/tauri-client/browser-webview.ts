import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";

import { invokeAsync } from "./invoke.js";

export const browserWebview = {
	open: (
		label: string,
		url: string,
		x: number,
		y: number,
		w: number,
		h: number
	): Effect.Effect<void, AppError> => {
		return invokeAsync("open_browser_webview", { label, url, x, y, w, h });
	},

	close: (label: string): Effect.Effect<void, AppError> => {
		return invokeAsync("close_browser_webview", { label });
	},

	resize: (
		label: string,
		x: number,
		y: number,
		w: number,
		h: number
	): Effect.Effect<void, AppError> => {
		return invokeAsync("resize_browser_webview", { label, x, y, w, h });
	},

	setZoom: (label: string, scale: number): Effect.Effect<void, AppError> => {
		return invokeAsync("set_browser_webview_zoom", { label, scale });
	},

	navigate: (label: string, url: string): Effect.Effect<void, AppError> => {
		return invokeAsync("navigate_browser_webview", { label, url });
	},

	reload: (label: string): Effect.Effect<void, AppError> => {
		return invokeAsync("reload_browser_webview", { label });
	},

	back: (label: string): Effect.Effect<void, AppError> => {
		return invokeAsync("browser_webview_back", { label });
	},

	forward: (label: string): Effect.Effect<void, AppError> => {
		return invokeAsync("browser_webview_forward", { label });
	},

	getUrl: (label: string): Effect.Effect<string, AppError> => {
		return invokeAsync("get_browser_webview_url", { label });
	},

	hide: (label: string): Effect.Effect<void, AppError> => {
		return invokeAsync("hide_browser_webview", { label });
	},

	show: (label: string): Effect.Effect<void, AppError> => {
		return invokeAsync("show_browser_webview", { label });
	},
};
