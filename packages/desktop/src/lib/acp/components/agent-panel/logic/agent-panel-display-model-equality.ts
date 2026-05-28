/**
 * Pure equality and array-index helpers for display rows and scene entries.
 * Extracted verbatim from agent-panel-display-model.ts.
 */

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { AgentPanelDisplayRow } from "./agent-panel-display-model.js";

export function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}

export function createArrayLikeOwnKeys(length: number): string[] {
	const keys: string[] = [];
	for (let index = 0; index < length; index += 1) {
		keys.push(String(index));
	}
	keys.push("length");
	return keys;
}

export function isDisplaySceneEntryStable(
	previous: AgentPanelSceneEntryModel | undefined,
	next: AgentPanelSceneEntryModel | undefined
): boolean {
	if (previous === next) {
		return true;
	}
	if (
		previous === undefined ||
		next === undefined ||
		previous.id !== next.id ||
		previous.type !== next.type
	) {
		return false;
	}
	if (previous.type === "user" && next.type === "user") {
		return previous.text === next.text && previous.isOptimistic === next.isOptimistic;
	}
	if (previous.type === "assistant" && next.type === "assistant") {
		return previous.markdown === next.markdown && previous.isStreaming === next.isStreaming;
	}
	return false;
}

export function areDisplayRowsEquivalent(
	left: AgentPanelDisplayRow,
	right: AgentPanelDisplayRow
): boolean {
	if (left.type !== right.type || left.id !== right.id) {
		return false;
	}
	if (left.type === "user" && right.type === "user") {
		return left.text === right.text && left.isOptimistic === right.isOptimistic;
	}
	if (left.type === "assistant" && right.type === "assistant") {
		return (
			left.canonicalText === right.canonicalText &&
			left.displayText === right.displayText &&
			left.canonicalTextRevision === right.canonicalTextRevision &&
			left.isLiveTail === right.isLiveTail
		);
	}
	return false;
}

export function areJsonLikeValuesEquivalent(left: unknown, right: unknown): boolean {
	if (left === right) {
		return true;
	}
	if (
		left === null ||
		right === null ||
		left === undefined ||
		right === undefined ||
		typeof left !== "object" ||
		typeof right !== "object"
	) {
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
	return leftEntries.every(([key, value]) =>
		areJsonLikeValuesEquivalent(value, rightRecord[key])
	);
}
