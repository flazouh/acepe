/**
 * Index builders for the agent-panel materializer: entry-id → transcript entry,
 * interaction-id → interaction, plus lazy appended/truncated interaction-index
 * views. Pure derivations over the canonical snapshots. GOD-safe.
 */
import type { InteractionSnapshot, TranscriptEntry } from "../../services/acp-types.js";
import { createPatchedReadonlyMap } from "./patched-readonly-map.js";

export function buildTranscriptEntryIndex(
	entries: readonly TranscriptEntry[]
): Map<string, TranscriptEntry> {
	const byEntryId = new Map<string, TranscriptEntry>();
	for (const entry of entries) {
		byEntryId.set(entry.entryId, entry);
	}
	return byEntryId;
}

export function buildInteractionIndex(
	interactions: readonly InteractionSnapshot[]
): Map<string, InteractionSnapshot> {
	const byInteractionId = new Map<string, InteractionSnapshot>();
	for (const interaction of interactions) {
		byInteractionId.set(interaction.id, interaction);
	}
	return byInteractionId;
}

export function createAppendedInteractionIndex(
	byInteractionId: ReadonlyMap<string, InteractionSnapshot>,
	appendedInteractions: readonly InteractionSnapshot[]
): ReadonlyMap<string, InteractionSnapshot> {
	if (appendedInteractions.length === 0) {
		return byInteractionId;
	}
	const appendedEntries = new Map<string, InteractionSnapshot>();
	for (const interaction of appendedInteractions) {
		appendedEntries.set(interaction.id, interaction);
	}
	return createPatchedReadonlyMap(byInteractionId, appendedEntries);
}

export function createTruncatedInteractionIndex(
	byInteractionId: ReadonlyMap<string, InteractionSnapshot>,
	previousInteractions: readonly InteractionSnapshot[],
	nextLength: number
): ReadonlyMap<string, InteractionSnapshot> {
	if (nextLength >= previousInteractions.length) {
		return byInteractionId;
	}
	const deletedKeys = new Set<string>();
	for (let index = nextLength; index < previousInteractions.length; index += 1) {
		const interaction = previousInteractions[index];
		if (interaction !== undefined) {
			deletedKeys.add(interaction.id);
		}
	}
	return createPatchedReadonlyMap(byInteractionId, new Map(), deletedKeys);
}
