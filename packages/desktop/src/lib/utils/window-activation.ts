import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import { TAURI_COMMAND_CLIENT } from "$lib/services/tauri-command-client.js";

/**
 * Activate the main window, bringing it to the foreground on macOS.
 *
 * Calls the Rust `activate_window` command which handles unminimize, show,
 * NSApp.activate(), and set_focus in the correct order.
 *
 * Callers decide how to handle failure (e.g., `.orElse()` for best-effort).
 */
export function activateMainWindow(): ResultAsync<void, Error> {
	return ResultAsync.fromPromise(
		invoke<void>(TAURI_COMMAND_CLIENT.window.activate.name, { label: "main" }),
		() => new Error("Failed to activate main window")
	);
}
