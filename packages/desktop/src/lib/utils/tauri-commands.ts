import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * Generic Tauri invoke for the small number of callsites that still need raw access.
 * Registry-backed app code should prefer TAURI_COMMAND_CLIENT or wrapper modules.
 */
export async function invoke<
	TResult,
	TArgs extends Record<string, string | number | boolean | null | undefined | object> = Record<
		string,
		string | number | boolean | null | undefined | object
	>,
>(command: string, args?: TArgs): Promise<TResult> {
	return tauriInvoke<TResult>(command, args);
}

export type { Commands as GeneratedCommands } from "../services/command-names.js";
export { COMMANDS as Commands } from "../services/command-names.js";
export { TAURI_COMMAND_CLIENT } from "../services/tauri-command-client.js";
