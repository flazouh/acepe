import type { ResultAsync } from "neverthrow";

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
	): ResultAsync<void, AppError> => {
		return invokeAsync("open_browser_webview", { label, url, x, y, w, h });
	},

	close: (label: string): ResultAsync<void, AppError> => {
		return invokeAsync("close_browser_webview", { label });
	},

	resize: (
		label: string,
		x: number,
		y: number,
		w: number,
		h: number
	): ResultAsync<void, AppError> => {
		return invokeAsync("resize_browser_webview", { label, x, y, w, h });
	},

	navigate: (label: string, url: string): ResultAsync<void, AppError> => {
		return invokeAsync("navigate_browser_webview", { label, url });
	},

	reload: (label: string): ResultAsync<void, AppError> => {
		return invokeAsync("reload_browser_webview", { label });
	},

	back: (label: string): ResultAsync<void, AppError> => {
		return invokeAsync("browser_webview_back", { label });
	},

	forward: (label: string): ResultAsync<void, AppError> => {
		return invokeAsync("browser_webview_forward", { label });
	},

	getUrl: (label: string): ResultAsync<string, AppError> => {
		return invokeAsync("get_browser_webview_url", { label });
	},

	hide: (label: string): ResultAsync<void, AppError> => {
		return invokeAsync("hide_browser_webview", { label });
	},

	show: (label: string): ResultAsync<void, AppError> => {
		return invokeAsync("show_browser_webview", { label });
	},
};
