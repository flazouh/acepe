/**
 * Legacy command names still used by a few facades.
 * The Tauri invoke transport is gone. Callers must use the Electrobun RPC client.
 */
export async function invoke<TResult>(
	command: string,
	_args?: Record<string, string | number | boolean | null | undefined | object>
): Promise<TResult> {
	throw new Error(`Tauri invoke is removed: ${command}. Use the Electrobun RPC client.`);
}

export type { Commands as GeneratedCommands } from "../services/command-names.js";
export { COMMANDS as Commands } from "../services/command-names.js";
