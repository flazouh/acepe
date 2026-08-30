// Window chrome has no Electrobun backend yet, so maximizeCurrentWindow still
// no-ops. The updater does: the shell reads version.json, checks the channel
// and swaps the bundle, and everything below asks it over the shell RPC.
import { LOGGER_IDS } from "../acp/constants/logger-ids.js";
import { createLogger } from "../acp/utils/logger.js";
import { isElectrobunShellWindow } from "../rpc/electrobun-shell-window.js";
import { readElectrobunBridge } from "../rpc/electrobun-bridge.js";
import {
	requestAppVersion,
	requestRelaunch,
	requestUpdate,
	type ShellUpdaterRequests,
} from "../rpc/shell-updater.js";
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

/**
 * The shell requests, or null in the website preview and in unit tests, where
 * there is no bun process to ask.
 */
function readUpdaterRequests(): ShellUpdaterRequests | null {
	const bridge = readElectrobunBridge();
	if (bridge === null) {
		return null;
	}
	return bridge.request;
}

export function relaunchApp(): Promise<void> {
	const requests = readUpdaterRequests();
	if (requests === null) {
		logger.warn("relaunchApp had no shell to ask");
		return Promise.resolve();
	}
	return requestRelaunch(requests);
}

export function checkForUpdate(): Promise<Update | null> {
	const requests = readUpdaterRequests();
	if (requests === null) {
		logger.info("checkForUpdate had no shell to ask, reporting no update");
		return Promise.resolve(null);
	}
	return requestUpdate(requests);
}

export function getAppVersion(): Promise<string | null> {
	const requests = readUpdaterRequests();
	if (requests === null) {
		return Promise.resolve(null);
	}
	return requestAppVersion(requests);
}

export type { DownloadEvent };
