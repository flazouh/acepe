// Agent-panel "waiting for response" derivation — U4 of the display-model
// retirement plan (docs/plans/2026-06-09-001-...). Extracted verbatim from
// buildAgentPanelBaseModel's waiting branch so the controller can derive it
// directly once the display-model round-trip is removed. Presentation-only
// (depends on the transient pendingSendIntent), so it stays controller-side,
// not in the canonical scene model.

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import type { AgentPanelCanonicalSource } from "../../../session-state/agent-panel-canonical-source.js";
import { getPreparingThreadLabel } from "./agent-panel-header-labels.js";

const WAITING_LABEL = "Planning next moves...";

export interface AgentPanelWaiting {
	readonly show: boolean;
	readonly label: string | null;
}

export interface AgentPanelWaitingInput {
	readonly graph: AgentPanelCanonicalSource | null;
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly pendingSendIntent: boolean;
	readonly agentName: string | null;
}

function hasLiveAssistantTail(sceneEntries: readonly AgentPanelSceneEntryModel[]): boolean {
	return sceneEntries.some((entry) => entry.type === "assistant" && entry.isStreaming === true);
}

export function deriveAgentPanelWaiting(input: AgentPanelWaitingInput): AgentPanelWaiting {
	if (input.graph === null) {
		// Pre-session: the only conversation entry is the optimistic pending user
		// row, so a non-empty scene (or an in-flight send) is the "preparing" signal.
		const hasPending = input.sceneEntries.length > 0 || input.pendingSendIntent;
		return {
			show: hasPending,
			label: hasPending ? getPreparingThreadLabel(input.agentName) : null,
		};
	}

	const shouldShow =
		input.pendingSendIntent ||
		(input.graph.activity.kind === "awaiting_model" && !hasLiveAssistantTail(input.sceneEntries));
	return {
		show: shouldShow,
		label: shouldShow ? WAITING_LABEL : null,
	};
}
