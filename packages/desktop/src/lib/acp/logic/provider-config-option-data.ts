/**
 * The one descriptor-to-ConfigOptionData conversion, shared by the two places
 * that build a renderable config option from a provider contract fact: the
 * composer's pre-canonical fallback (composer-view-controller.svelte.ts) and
 * the reopen graph builder (reopen-snapshot-graph.ts), which pairs the
 * catalog with the session's canonical stored values. One body, so a field
 * added to the descriptor cannot reach one site and not the other.
 */
import type { ProviderConfigOptionDescriptor } from "@acepe/contracts";
import type { ConfigOptionData } from "../../services/acp-types.js";

export function configOptionDataFromDescriptor(
	option: ProviderConfigOptionDescriptor,
	currentValue: string = option.currentValue
): ConfigOptionData {
	return {
		id: option.id,
		name: option.name,
		category: option.category,
		type: option.type,
		description: option.description,
		currentValue,
		options: option.options.map((value) => ({
			name: value.name,
			value: value.value,
		})),
		presentation: option.presentation,
	};
}
