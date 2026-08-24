// MainAppView (main-app-view.svelte) is the real agent-panel UI. It used to
// run only under the Tauri shell, where window chrome, app relaunch, and
// auto-update are backed by real @tauri-apps/* plugins. Now that it also
// mounts under Electrobun (see routes/+page.svelte), those three surfaces
// have no working backend yet -- there is no Tauri runtime under
// `views:` / `__electrobun`. Rather than let the real Tauri API calls throw
// on a missing `window.__TAURI_INTERNALS__`, these wrappers detect the shell
// and either delegate to the real Tauri plugin (Tauri shell) or no-op with
// an honest log line (Electrobun shell). No behaviour regression for Tauri;
// no silent failure for Electrobun.
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { LOGGER_IDS } from "../acp/constants/logger-ids.js";
import { createLogger } from "../acp/utils/logger.js";
import { isElectrobunShellWindow } from "../rpc/electrobun-shell-window.js";

const logger = createLogger({
	id: LOGGER_IDS.ELECTROBUN_SHIMS,
	name: "Electrobun Window Shims",
});

function runningUnderElectrobun(): boolean {
	return isElectrobunShellWindow({
		protocol: window.location.protocol,
		search: window.location.search,
		hasElectrobunGlobal: "__electrobun" in window,
	});
}

// Window chrome (maximize/minimize/close) is managed by the Electrobun shell
// itself, not by an in-page API today.
export function maximizeCurrentWindow(): Promise<void> {
	if (runningUnderElectrobun()) {
		logger.info("maximizeCurrentWindow is a no-op under Electrobun (shell owns window chrome)");
		return Promise.resolve();
	}
	return import("@tauri-apps/api/window").then((mod) => mod.getCurrentWindow().maximize());
}

// No Electrobun-side relaunch primitive exists yet; a real update can never
// reach this path under Electrobun because checkForUpdate() below always
// reports "no update available" there, but keep the wrapper honest anyway.
export function relaunchApp(): Promise<void> {
	if (runningUnderElectrobun()) {
		logger.warn("relaunchApp is a no-op under Electrobun (no relaunch primitive wired yet)");
		return Promise.resolve();
	}
	return import("@tauri-apps/plugin-process").then((mod) => mod.relaunch());
}

// The updater's own manifest/signature check has no Electrobun-side
// equivalent yet (packaging + signing is a separate slice). Reporting "no
// update available" is the honest degrade: the update banner simply never
// appears, instead of throwing on a missing Tauri updater plugin.
export function checkForUpdate(): Promise<Update | null> {
	if (runningUnderElectrobun()) {
		logger.info("checkForUpdate always reports no update under Electrobun (updater not wired yet)");
		return Promise.resolve(null);
	}
	return import("@tauri-apps/plugin-updater").then((mod) => mod.check());
}

export function getAppVersion(): Promise<string | null> {
	if (runningUnderElectrobun()) {
		logger.info("getAppVersion has no Electrobun source yet");
		return Promise.resolve(null);
	}
	return import("@tauri-apps/api/app").then((mod) => mod.getVersion());
}

export type { DownloadEvent };
