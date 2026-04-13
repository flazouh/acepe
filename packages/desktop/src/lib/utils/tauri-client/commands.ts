/**
 * Compatibility layer for the few remaining dynamic or legacy command callsites.
 * Registry-backed wrappers should prefer `TAURI_COMMAND_CLIENT`.
 */
import { COMMANDS } from "$lib/services/command-names.js";
import { NON_REGISTRY_COMMANDS } from "./non-registry-command-allowlist.js";

const ACP_PREFIX = "acp_";

export const CMD = {
	acp: {
		...COMMANDS.acp,
		// Dynamic ACP commands keep the shared runtime prefix by design.
		prefix: ACP_PREFIX,
	},
	notifications: NON_REGISTRY_COMMANDS.notifications,
} as const;

export { ACP_PREFIX };
