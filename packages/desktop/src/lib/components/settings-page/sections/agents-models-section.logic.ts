import { SvelteSet } from "svelte/reactivity";

const MIN_SELECTED_AGENTS_ERROR = "At least one agent must remain selected";

type AgentSelectionUpdateResult =
	| {
			readonly ok: true;
			readonly changed: boolean;
			readonly value: string[];
	  }
	| {
			readonly ok: false;
			readonly error: string;
	  };

/**
 * Computes selected agent IDs from a Switch checked event.
 * Handles duplicate change events idempotently to avoid double-toggle state churn.
 */
export function applyAgentSelectionChange(
	currentSelectedAgentIds: readonly string[],
	agentId: string,
	checked: boolean
): AgentSelectionUpdateResult {
	const normalizedCurrent = Array.from(new SvelteSet(currentSelectedAgentIds));
	const currentlySelected = normalizedCurrent.includes(agentId);

	// Idempotent no-op for repeated checked events with same value.
	if (checked === currentlySelected) {
		return {
			ok: true,
			changed: false,
			value: normalizedCurrent,
		};
	}

	if (checked) {
		return {
			ok: true,
			changed: true,
			value: [...normalizedCurrent, agentId],
		};
	}

	if (normalizedCurrent.length === 1) {
		return {
			ok: false,
			error: MIN_SELECTED_AGENTS_ERROR,
		};
	}

	return {
		ok: true,
		changed: true,
		value: normalizedCurrent.filter((id) => id !== agentId),
	};
}
