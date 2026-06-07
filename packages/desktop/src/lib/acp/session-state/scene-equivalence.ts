/**
 * Pure equivalence predicates used by the agent-panel graph materializer's
 * conversation-patch fast paths — scene-entry, streaming-tail, and activity
 * comparisons plus a structural JSON-like deep-equals. No canonical state, no
 * side effects. GOD-safe leaf helpers.
 */
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import type { AgentPanelCanonicalSource } from "./agent-panel-canonical-source.js";

export function areJsonLikeValuesEquivalent(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}
	if (typeof left !== typeof right) {
		return false;
	}
	if (left === null || right === null) {
		return false;
	}
	if (typeof left !== "object" || typeof right !== "object") {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}
		return left.every((item, index) => areJsonLikeValuesEquivalent(item, right[index]));
	}

	const leftEntries = Object.entries(left);
	const rightRecord = right as Record<string, unknown>;
	if (leftEntries.length !== Object.keys(rightRecord).length) {
		return false;
	}
	return leftEntries.every(([key, value]) => areJsonLikeValuesEquivalent(value, rightRecord[key]));
}

export function areSceneEntriesEquivalent(
	left: AgentPanelSceneEntryModel,
	right: AgentPanelSceneEntryModel
): boolean {
	return areJsonLikeValuesEquivalent(left, right);
}

export function areActiveStreamingTailsEquivalent(
	left: AgentPanelCanonicalSource["activeStreamingTail"],
	right: AgentPanelCanonicalSource["activeStreamingTail"]
): boolean {
	if (left === right) {
		return true;
	}
	if (left === null || right === null) {
		return false;
	}
	return left.rowId === right.rowId && left.contentKind === right.contentKind;
}

export function areActivitiesEquivalent(
	left: AgentPanelCanonicalSource["activity"],
	right: AgentPanelCanonicalSource["activity"]
): boolean {
	return (
		left === right ||
		(left.kind === right.kind &&
			left.activeOperationCount === right.activeOperationCount &&
			left.activeSubagentCount === right.activeSubagentCount &&
			left.dominantOperationId === right.dominantOperationId &&
			left.blockingInteractionId === right.blockingInteractionId)
	);
}

export function areActivitiesCompatibleForConversationPatch(
	left: AgentPanelCanonicalSource["activity"],
	right: AgentPanelCanonicalSource["activity"]
): boolean {
	return left.blockingInteractionId === right.blockingInteractionId;
}
