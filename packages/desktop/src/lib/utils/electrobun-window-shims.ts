// Window chrome, relaunch, and auto-update have no Electrobun backend yet.
// These wrappers no-op instead of calling a removed Tauri plugin.
import { LOGGER_IDS } from "../acp/constants/logger-ids.js";
import { createLogger } from "../acp/utils/logger.js";
import { isElectrobunShellWindow } from "../rpc/electrobun-shell-window.js";
import type { DownloadEvent, Update } from "./updater-types.js";

const logger = createLogger({
	id: LOGGER_IDS.ELECTROBUN_SHIMS,
	name: "Electrobun Window Shims",
});

export function runningUnderElectrobun(): boolean {
	if (typeof window === "undefined") {
		return true;
	}
	return isElectrobunShellWindow({
		protocol: window.location.protocol,
		search: window.location.search,
		hasElectrobunGlobal: "__electrobun" in window,
	});
}

export function maximizeCurrentWindow(): Promise<void> {
	logger.info("maximizeCurrentWindow is a no-op (shell owns window chrome)");
	return Promise.resolve();
}

export function relaunchApp(): Promise<void> {
	logger.warn("relaunchApp is a no-op (no relaunch primitive wired yet)");
	return Promise.resolve();
}

export function checkForUpdate(): Promise<Update | null> {
	logger.info("checkForUpdate always reports no update (updater not wired yet)");
	return Promise.resolve(null);
}

export function getAppVersion(): Promise<string | null> {
	logger.info("getAppVersion has no Electrobun source yet");
	return Promise.resolve(null);
}

export type { DownloadEvent };
