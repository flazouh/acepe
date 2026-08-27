import type { SessionGraphCapabilities } from "../../../services/acp-types.js";

/**
 * #283: the canonical current mode, written onto an existing capabilities
 * projection and nothing else.
 *
 * A `SessionModeSet` is one narrow fact. Every other capability here belongs to
 * a different producer -- the models and their display grouping, the available
 * commands, the config options, the autonomous flag -- and a mode change is not
 * evidence about any of them, so all of them are carried through unchanged.
 *
 * `availableModes` is provider-owned and stays exactly as it was. When the
 * session carries no `modes` object yet, this adds one holding the mode alone,
 * the same shape the reopen path already installs (reopen-snapshot-graph.ts's
 * `capabilitiesFromSnapshot`). That is deliberate: `modes` being present at all
 * is what makes capability-projection.ts's `mapGraphAvailableModes` report an
 * empty list instead of `null` ("not known yet"), and only a real canonical
 * mode may cost the session that distinction.
 */
export function capabilitiesWithSessionMode(
	capabilities: SessionGraphCapabilities,
	currentModeId: string
): SessionGraphCapabilities {
	const previousModes = capabilities.modes ?? null;
	return {
		models: capabilities.models ?? null,
		modes:
			previousModes === null || previousModes.availableModes === undefined
				? { currentModeId }
				: { currentModeId, availableModes: previousModes.availableModes },
		availableCommands: capabilities.availableCommands,
		configOptions: capabilities.configOptions,
		autonomousEnabled: capabilities.autonomousEnabled,
	};
}
