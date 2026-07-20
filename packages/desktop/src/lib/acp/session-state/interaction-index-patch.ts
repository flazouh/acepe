/**
 * Index-patch resolvers for the agent-panel materializer's conversation fast
 * paths: incrementally derive the next interaction index / transcript-entry
 * index from the previous one (patched / appended / truncated), falling back to
 * a full rebuild when the shape isn't stable. Pure derivations. GOD-safe.
 */
import type { InteractionSnapshot, TranscriptEntry } from "../../services/acp-types.js";
import { collectAppendedInteractions } from "./conversation-stability.js";
import { getInteractionSnapshotArrayPatch } from "./interaction-snapshot-array-patch.js";
import { createPatchedReadonlyMap } from "./patched-readonly-map.js";
import {
	buildInteractionIndex,
	createAppendedInteractionIndex,
	createTruncatedInteractionIndex,
} from "./transcript-interaction-index.js";

export function createPatchedInteractionIndex(
	byInteractionId: ReadonlyMap<string, InteractionSnapshot>,
	patchedInteractionsByIndex: ReadonlyMap<number, InteractionSnapshot> | null,
	appendedInteractions: readonly InteractionSnapshot[] | null
): ReadonlyMap<string, InteractionSnapshot> {
	const patches = new Map<string, InteractionSnapshot>();
	if (patchedInteractionsByIndex !== null) {
		for (const interaction of patchedInteractionsByIndex.values()) {
			patches.set(interaction.id, interaction);
		}
	}
	if (appendedInteractions !== null) {
		for (const interaction of appendedInteractions) {
			patches.set(interaction.id, interaction);
		}
	}
	return createPatchedReadonlyMap(byInteractionId, patches);
}

export function resolveUpdatedInteractionIndex(
	previousInteractionById: ReadonlyMap<string, InteractionSnapshot>,
	previousInteractions: readonly InteractionSnapshot[],
	nextInteractions: readonly InteractionSnapshot[]
): ReadonlyMap<string, InteractionSnapshot> {
	if (nextInteractions === previousInteractions) {
		return previousInteractionById;
	}

	const interactionPatch = getInteractionSnapshotArrayPatch(nextInteractions);
	if (interactionPatch?.baseInteractions === previousInteractions) {
		if (
			interactionPatch.patchedInteractionsByIndex === null &&
			interactionPatch.appendedInteractions !== null
		) {
			return createAppendedInteractionIndex(
				previousInteractionById,
				interactionPatch.appendedInteractions
			);
		}
		return createPatchedInteractionIndex(
			previousInteractionById,
			interactionPatch.patchedInteractionsByIndex,
			interactionPatch.appendedInteractions
		);
	}

	if (nextInteractions.length > previousInteractions.length) {
		return createAppendedInteractionIndex(
			previousInteractionById,
			collectAppendedInteractions(nextInteractions, previousInteractions.length)
		);
	}
	if (nextInteractions.length < previousInteractions.length) {
		return createTruncatedInteractionIndex(
			previousInteractionById,
			previousInteractions,
			nextInteractions.length
		);
	}

	const stablePrefixPatch = collectStableInteractionPrefixPatches(
		previousInteractions,
		nextInteractions
	);
	if (stablePrefixPatch === null) {
		return buildInteractionIndex(nextInteractions);
	}
	if (stablePrefixPatch.size > 0) {
		return createPatchedInteractionIndex(previousInteractionById, stablePrefixPatch, null);
	}

	return previousInteractionById;
}

export function collectStableInteractionPrefixPatches(
	previousInteractions: readonly InteractionSnapshot[],
	nextInteractions: readonly InteractionSnapshot[]
): ReadonlyMap<number, InteractionSnapshot> | null {
	const stableLength = Math.min(previousInteractions.length, nextInteractions.length);
	const patchedInteractionsByIndex = new Map<number, InteractionSnapshot>();
	for (let index = 0; index < stableLength; index += 1) {
		const previousInteraction = previousInteractions[index];
		const nextInteraction = nextInteractions[index];
		if (
			previousInteraction === undefined ||
			nextInteraction === undefined ||
			previousInteraction.id !== nextInteraction.id
		) {
			return null;
		}
		if (previousInteraction !== nextInteraction) {
			patchedInteractionsByIndex.set(index, nextInteraction);
		}
	}
	return patchedInteractionsByIndex;
}

export function appendTranscriptEntryIndexFromRange(
	byEntryId: ReadonlyMap<string, TranscriptEntry>,
	entries: readonly TranscriptEntry[],
	startIndex: number
): ReadonlyMap<string, TranscriptEntry> {
	const appendedEntries = new Map<string, TranscriptEntry>();
	for (let index = startIndex; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry !== undefined) {
			appendedEntries.set(entry.entryId, entry);
		}
	}
	return createPatchedReadonlyMap(byEntryId, appendedEntries);
}

export function createAppendedTranscriptEntryIndex(
	byEntryId: ReadonlyMap<string, TranscriptEntry>,
	entries: readonly TranscriptEntry[],
	startIndex: number
): ReadonlyMap<string, TranscriptEntry> {
	return appendTranscriptEntryIndexFromRange(byEntryId, entries, startIndex);
}

export function createTruncatedTranscriptEntryIndex(
	byEntryId: ReadonlyMap<string, TranscriptEntry>,
	previousEntries: readonly TranscriptEntry[],
	length: number
): ReadonlyMap<string, TranscriptEntry> {
	const deletedKeys = new Set<string>();
	for (let index = length; index < previousEntries.length; index += 1) {
		const entry = previousEntries[index];
		if (entry !== undefined) {
			deletedKeys.add(entry.entryId);
		}
	}
	return createPatchedReadonlyMap(byEntryId, new Map(), deletedKeys);
}
