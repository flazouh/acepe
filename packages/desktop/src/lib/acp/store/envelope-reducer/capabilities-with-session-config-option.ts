import { providerConfigOptions } from "@acepe/contracts";
import type {
	CanonicalAgentId,
	ConfigOptionData,
	SessionGraphCapabilities,
} from "../../../services/acp-types.js";
import { configOptionDataFromDescriptor } from "../../logic/provider-config-option-data.js";

/**
 * One canonical config option value, written onto an existing capabilities
 * projection and nothing else -- the config-option counterpart of
 * `capabilitiesWithSessionMode`. Every other capability belongs to a
 * different producer and is carried through unchanged.
 *
 * The value usually arrives before any producer has filled canonical
 * `configOptions`: no provider publishes an option catalog live, so mid-run
 * the field is null until a reopen installs the snapshot's pairing. In that
 * case this seeds the catalog from the provider contract fact with the value
 * applied -- exactly the pairing reopen-snapshot-graph.ts's
 * `capabilitiesFromSnapshot` performs, through the same
 * `configOptionDataFromDescriptor`. A session whose provider has no contract
 * catalog keeps `configOptions` null: there is no descriptor authority to
 * pair the value with, and inventing a bare entry would hand the widget a
 * select with no choices.
 */
export function capabilitiesWithSessionConfigOption(
	capabilities: SessionGraphCapabilities,
	agentId: CanonicalAgentId | null,
	configId: string,
	value: string
): SessionGraphCapabilities {
	return {
		models: capabilities.models ?? null,
		modes: capabilities.modes ?? null,
		availableCommands: capabilities.availableCommands,
		configOptions: configOptionsWithValue(
			capabilities.configOptions ?? null,
			agentId,
			configId,
			value
		),
		autonomousEnabled: capabilities.autonomousEnabled,
	};
}

function configOptionsWithValue(
	previous: ConfigOptionData[] | null,
	agentId: CanonicalAgentId | null,
	configId: string,
	value: string
): ConfigOptionData[] | null {
	// An empty list is treated like null on purpose: it holds no descriptor
	// the value could land on, so only the contract catalog can carry it.
	if (previous !== null && previous.length > 0) {
		return previous.map((option) =>
			option.id === configId ? { ...option, currentValue: value } : option
		);
	}
	const providerId = agentId === null ? null : typeof agentId === "string" ? agentId : null;
	const catalog = providerConfigOptions(providerId);
	if (catalog.length === 0) {
		return null;
	}
	return catalog.map((option) =>
		configOptionDataFromDescriptor(option, option.id === configId ? value : option.currentValue)
	);
}
