import type { SessionGraphCapabilities } from "../../../services/acp-types.js";

export function emptySessionGraphCapabilities(): SessionGraphCapabilities {
	return {
		models: null,
		modes: null,
		availableCommands: null,
		configOptions: null,
		autonomousEnabled: null,
	};
}
