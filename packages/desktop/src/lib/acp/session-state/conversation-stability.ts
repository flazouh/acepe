/**
 * Stability predicates + collectors for the agent-panel materializer's
 * conversation-patch fast paths: detect stable transcript append/patch/truncate
 * shapes, collect appended/patched entries, list visible interaction entries,
 * and compare scene-entry lists. Pure helpers over canonical snapshots. GOD-safe.
 */

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import type { InteractionSnapshot, TranscriptEntry } from "../../services/acp-types.js";
import type { AgentPanelCanonicalSource } from "./agent-panel-canonical-source.js";
import { questionInteractionToSceneEntry } from "./entry-materializers.js";
import { areSceneEntriesEquivalent } from "./scene-equivalence.js";

export function materializeVisibleInteractionEntries(
	graph: AgentPanelCanonicalSource,
	sceneEntryRowIndex: ReadonlyMap<string, number>
): AgentPanelSceneEntryModel[] {
	const entries: AgentPanelSceneEntryModel[] = [];
	for (const interaction of graph.interactions) {
		const entry = questionInteractionToSceneEntry(interaction, graph);
		if (entry === null || sceneEntryRowIndex.has(entry.id)) {
			continue;
		}
		entries.push(entry);
	}
	return entries;
}

export function areSceneEntryListsEquivalent(
	left: readonly AgentPanelSceneEntryModel[],
	right: readonly AgentPanelSceneEntryModel[]
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((entry, index) => areSceneEntriesEquivalent(entry, right[index]));
}

export function isStableTranscriptAppend(
	previousEntries: readonly TranscriptEntry[],
	nextEntries: readonly TranscriptEntry[]
): boolean {
	if (nextEntries.length < previousEntries.length) {
		return false;
	}

	for (let index = 0; index < previousEntries.length; index += 1) {
		if (nextEntries[index] !== previousEntries[index]) {
			return false;
		}
	}

	return true;
}

export function isStableTranscriptPatchAndAppend(
	previousEntries: readonly TranscriptEntry[],
	nextEntries: readonly TranscriptEntry[]
): boolean {
	if (nextEntries.length <= previousEntries.length) {
		return false;
	}

	let sawPatchedPrefixEntry = false;
	for (let index = 0; index < previousEntries.length; index += 1) {
		const previousEntry = previousEntries[index];
		const nextEntry = nextEntries[index];
		if (previousEntry === undefined || nextEntry === undefined) {
			return false;
		}
		if (previousEntry.entryId !== nextEntry.entryId) {
			return false;
		}
		if (previousEntry !== nextEntry) {
			sawPatchedPrefixEntry = true;
		}
	}
	return sawPatchedPrefixEntry;
}

export function isStableTranscriptTruncation(
	previousEntries: readonly TranscriptEntry[],
	nextEntries: readonly TranscriptEntry[]
): boolean {
	if (nextEntries.length >= previousEntries.length) {
		return false;
	}

	for (let index = 0; index < nextEntries.length; index += 1) {
		if (nextEntries[index] !== previousEntries[index]) {
			return false;
		}
	}

	return true;
}

export function collectStableTranscriptPatchedEntriesByIndex(
	previousEntries: readonly TranscriptEntry[],
	nextEntries: readonly TranscriptEntry[]
): ReadonlyMap<number, TranscriptEntry> | null {
	let patches: Map<number, TranscriptEntry> | null = null;
	for (let index = 0; index < previousEntries.length; index += 1) {
		const previousEntry = previousEntries[index];
		const nextEntry = nextEntries[index];
		if (previousEntry === undefined || nextEntry === undefined) {
			return null;
		}
		if (previousEntry.entryId !== nextEntry.entryId) {
			return null;
		}
		if (previousEntry === nextEntry) {
			continue;
		}
		patches ??= new Map<number, TranscriptEntry>();
		patches.set(index, nextEntry);
	}
	return patches;
}

export function collectAppendedTranscriptEntries(
	entries: readonly TranscriptEntry[],
	startIndex: number
): readonly TranscriptEntry[] {
	const appendedEntries: TranscriptEntry[] = [];
	for (let index = startIndex; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry !== undefined) {
			appendedEntries.push(entry);
		}
	}
	return appendedEntries;
}

export function collectAppendedInteractions(
	interactions: readonly InteractionSnapshot[],
	startIndex: number
): readonly InteractionSnapshot[] {
	const appendedInteractions: InteractionSnapshot[] = [];
	for (let index = startIndex; index < interactions.length; index += 1) {
		const interaction = interactions[index];
		if (interaction !== undefined) {
			appendedInteractions.push(interaction);
		}
	}
	return appendedInteractions;
}
