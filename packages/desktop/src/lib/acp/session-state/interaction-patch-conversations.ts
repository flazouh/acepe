/**
 * Interaction-patch conversation fast paths for the agent-panel materializer:
 * given a prior CachedConversationState, incrementally re-materialize when the
 * interaction set changed (patch / stable-patch / blocking-retarget / stable
 * append / stable truncate / marked-patch). Pure; selected by the dispatcher.
 */
import type { InteractionSnapshot } from "../../services/acp-types.js";
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import type {
	CachedConversationInput,
	CachedConversationState,
} from "./conversation-cache-types.js";
import {
	createAppendedSceneEntryArray,
	createInsertedSceneEntryArray,
	createPatchedSceneEntryArray,
} from "./scene-entry-array.js";
import {
	createAppendedSceneEntryRowIndex,
	createSplicedSceneEntryRowIndex,
} from "./scene-entry-row-index.js";
import { interactionSceneEntryId, questionInteractionToSceneEntry } from "./entry-materializers.js";
import {
	areSceneEntryListsEquivalent,
	collectAppendedInteractions,
	materializeVisibleInteractionEntries,
} from "./conversation-stability.js";
import { areActiveStreamingTailsEquivalent, areSceneEntriesEquivalent } from "./scene-equivalence.js";
import {
	createAppendedInteractionIndex,
	createTruncatedInteractionIndex,
} from "./transcript-interaction-index.js";
import {
	createPatchedInteractionIndex,
	resolveUpdatedInteractionIndex,
} from "./interaction-index-patch.js";
import { getInteractionSnapshotArrayPatch } from "./interaction-snapshot-array-patch.js";
import { collectTrailingSceneEntries } from "./transcript-patch-conversations.js";

export function materializeInteractionPatchedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.transcriptEntries !== input.graph.transcriptSnapshot.entries ||
		previous.operations !== input.graph.operations ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		)
	) {
		return null;
	}

	const interactionArrayPatch = getInteractionSnapshotArrayPatch(input.graph.interactions);
	if (interactionArrayPatch?.baseInteractions === previous.interactions) {
		const patched = materializeMarkedInteractionPatchedConversation(
			previous,
			input,
			interactionArrayPatch.patchedInteractionsByIndex,
			interactionArrayPatch.appendedInteractions
		);
		if (patched !== null) {
			return patched;
		}
	}
	const stableInteractionPatch = materializeStableInteractionPatchedConversation(
		previous,
		input
	);
	if (stableInteractionPatch !== null) {
		return stableInteractionPatch;
	}
	const blockingInteractionRetarget = materializeBlockingInteractionRetargetConversation(
		previous,
		input
	);
	if (blockingInteractionRetarget !== null) {
		return blockingInteractionRetarget;
	}
	const stableInteractionAppend = materializeStableInteractionAppendedConversation(
		previous,
		input
	);
	if (stableInteractionAppend !== null) {
		return stableInteractionAppend;
	}
	const stableInteractionTruncation = materializeStableInteractionTruncatedConversation(
		previous,
		input
	);
	if (stableInteractionTruncation !== null) {
		return stableInteractionTruncation;
	}

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const nextInteractionEntries = materializeVisibleInteractionEntries(
		input.graph,
		previous.sceneEntryRowIndex
	);
	const previousInteractionEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	const interactionById = resolveUpdatedInteractionIndex(
		previous.interactionById,
		previous.interactions,
		input.graph.interactions
	);
	if (areSceneEntryListsEquivalent(previousInteractionEntries, nextInteractionEntries)) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}

	const nextEntries = createInsertedSceneEntryArray(
		previous.conversation.entries,
		transcriptSceneEntryCount,
		nextInteractionEntries,
		[]
	);
	const sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
		previous.sceneEntryRowIndex,
		previousInteractionEntries,
		nextInteractionEntries,
		transcriptSceneEntryCount
	);
	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries: nextEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex,
	};
}

export function materializeStableInteractionPatchedConversation(
	previous: CachedConversationState,
	input: CachedConversationInput
): CachedConversationState | null {
	if (input.graph.interactions.length !== previous.interactions.length) {
		return null;
	}

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const previousVisibleEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (previousVisibleEntries.length > 1) {
		return null;
	}
	const previousVisibleEntry = previousVisibleEntries[0] ?? null;
	const patchedInteractionsByIndex = new Map<number, InteractionSnapshot>();
	for (let index = 0; index < input.graph.interactions.length; index += 1) {
		const previousInteraction = previous.interactions[index];
		const nextInteraction = input.graph.interactions[index];
		if (previousInteraction === undefined || nextInteraction === undefined) {
			return null;
		}
		if (previousInteraction.id !== nextInteraction.id) {
			return null;
		}
		if (previousInteraction !== nextInteraction) {
			patchedInteractionsByIndex.set(index, nextInteraction);
		}
	}
	if (patchedInteractionsByIndex.size === 0) {
		return null;
	}

	const interactionById = createPatchedInteractionIndex(
		previous.interactionById,
		patchedInteractionsByIndex,
		null
	);
	const nextBlockingInteractionId = input.graph.activity.blockingInteractionId ?? null;
	const nextVisibleInteraction =
		nextBlockingInteractionId === null ? null : interactionById.get(nextBlockingInteractionId) ?? null;
	const nextVisibleEntry =
		nextVisibleInteraction === null
			? null
			: questionInteractionToSceneEntry(nextVisibleInteraction, input.graph);

	if (
		previousVisibleEntry !== null &&
		nextVisibleEntry !== null &&
		previousVisibleEntry.id === nextVisibleEntry.id &&
		areSceneEntriesEquivalent(previousVisibleEntry, nextVisibleEntry)
	) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}

	if (previousVisibleEntry === null && nextVisibleEntry === null) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}

	let nextEntries: readonly AgentPanelSceneEntryModel[];
	let sceneEntryRowIndex: ReadonlyMap<string, number>;
	if (previousVisibleEntry === null && nextVisibleEntry !== null) {
		nextEntries = createAppendedSceneEntryArray(previous.conversation.entries, [nextVisibleEntry]);
		sceneEntryRowIndex = createAppendedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[nextVisibleEntry],
			previous.conversation.entries.length
		);
	} else if (previousVisibleEntry !== null && nextVisibleEntry === null) {
		nextEntries = createInsertedSceneEntryArray(
			previous.conversation.entries,
			transcriptSceneEntryCount,
			[],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[previousVisibleEntry],
			[],
			transcriptSceneEntryCount
		);
	} else if (
		previousVisibleEntry !== null &&
		nextVisibleEntry !== null &&
		previousVisibleEntry.id === nextVisibleEntry.id
	) {
		nextEntries = createPatchedSceneEntryArray(
			previous.conversation.entries,
			new Map([[transcriptSceneEntryCount, nextVisibleEntry]])
		);
		sceneEntryRowIndex = previous.sceneEntryRowIndex;
	} else {
		nextEntries = createInsertedSceneEntryArray(
			previous.conversation.entries,
			transcriptSceneEntryCount,
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			previousVisibleEntry === null ? [] : [previousVisibleEntry],
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			transcriptSceneEntryCount
		);
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries: nextEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex,
	};
}

export function materializeBlockingInteractionRetargetConversation(
	previous: CachedConversationState,
	input: CachedConversationInput
): CachedConversationState | null {
	const previousBlockingInteractionId = previous.activity.blockingInteractionId ?? null;
	const nextBlockingInteractionId = input.graph.activity.blockingInteractionId ?? null;
	if (previousBlockingInteractionId === nextBlockingInteractionId) {
		return null;
	}

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const previousVisibleEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (previousVisibleEntries.length > 1) {
		return null;
	}
	const previousVisibleEntry = previousVisibleEntries[0] ?? null;
	const nextVisibleInteraction =
		nextBlockingInteractionId === null
			? null
			: previous.interactionById.get(nextBlockingInteractionId) ?? null;
	if (nextBlockingInteractionId !== null && nextVisibleInteraction === null) {
		return null;
	}

	const nextVisibleEntry =
		nextVisibleInteraction === null
			? null
			: questionInteractionToSceneEntry(nextVisibleInteraction, input.graph);
	const interactionById = resolveUpdatedInteractionIndex(
		previous.interactionById,
		previous.interactions,
		input.graph.interactions
	);

	if (
		previousVisibleEntry !== null &&
		nextVisibleEntry !== null &&
		previousVisibleEntry.id === nextVisibleEntry.id &&
		areSceneEntriesEquivalent(previousVisibleEntry, nextVisibleEntry)
	) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}

	let nextEntries: readonly AgentPanelSceneEntryModel[];
	let sceneEntryRowIndex: ReadonlyMap<string, number>;
	if (previousVisibleEntry === null && nextVisibleEntry === null) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}
	if (previousVisibleEntry === null && nextVisibleEntry !== null) {
		nextEntries = createAppendedSceneEntryArray(previous.conversation.entries, [nextVisibleEntry]);
		sceneEntryRowIndex = createAppendedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[nextVisibleEntry],
			previous.conversation.entries.length
		);
	} else if (previousVisibleEntry !== null && nextVisibleEntry === null) {
		nextEntries = createInsertedSceneEntryArray(
			previous.conversation.entries,
			transcriptSceneEntryCount,
			[],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[previousVisibleEntry],
			[],
			transcriptSceneEntryCount
		);
	} else {
		nextEntries = createInsertedSceneEntryArray(
			previous.conversation.entries,
			transcriptSceneEntryCount,
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			previousVisibleEntry === null ? [] : [previousVisibleEntry],
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			transcriptSceneEntryCount
		);
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries: nextEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex,
	};
}

export function materializeStableInteractionAppendedConversation(
	previous: CachedConversationState,
	input: CachedConversationInput
): CachedConversationState | null {
	if (input.graph.interactions.length <= previous.interactions.length) {
		return null;
	}

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const previousVisibleEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (previousVisibleEntries.length > 1) {
		return null;
	}

	const previousVisibleEntry: AgentPanelSceneEntryModel | null =
		previousVisibleEntries[0] ?? null;
	const previousBlockingInteractionId = previous.activity.blockingInteractionId ?? null;
	const nextBlockingInteractionId = input.graph.activity.blockingInteractionId ?? null;
	const appendedInteractions = collectAppendedInteractions(
		input.graph.interactions,
		previous.interactions.length
	);
	const interactionById = createAppendedInteractionIndex(
		previous.interactionById,
		appendedInteractions
	);
	if (nextBlockingInteractionId === previousBlockingInteractionId) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}
	if (nextBlockingInteractionId === null) {
		return null;
	}
	let nextVisibleEntry: AgentPanelSceneEntryModel | null = null;
	for (const interaction of appendedInteractions) {
		if (interaction.id !== nextBlockingInteractionId) {
			continue;
		}
		nextVisibleEntry = questionInteractionToSceneEntry(interaction, input.graph);
		break;
	}
	if (nextVisibleEntry === null) {
		return null;
	}

	if (
		previousVisibleEntry !== null &&
		previousVisibleEntry.id === nextVisibleEntry.id &&
		areSceneEntriesEquivalent(previousVisibleEntry, nextVisibleEntry)
	) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}

	let nextEntries: readonly AgentPanelSceneEntryModel[];
	let sceneEntryRowIndex: ReadonlyMap<string, number>;
	if (previousVisibleEntry === null) {
		nextEntries = createAppendedSceneEntryArray(previous.conversation.entries, [nextVisibleEntry]);
		sceneEntryRowIndex = createAppendedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[nextVisibleEntry],
			previous.conversation.entries.length
		);
	} else {
		nextEntries = createInsertedSceneEntryArray(
			previous.conversation.entries,
			transcriptSceneEntryCount,
			[nextVisibleEntry],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[previousVisibleEntry],
			[nextVisibleEntry],
			transcriptSceneEntryCount
		);
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries: nextEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex,
	};
}

export function materializeStableInteractionTruncatedConversation(
	previous: CachedConversationState,
	input: CachedConversationInput
): CachedConversationState | null {
	if (input.graph.interactions.length >= previous.interactions.length) {
		return null;
	}

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const previousVisibleEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (previousVisibleEntries.length > 1) {
		return null;
	}

	const previousVisibleEntry: AgentPanelSceneEntryModel | null =
		previousVisibleEntries[0] ?? null;
	const interactionById = createTruncatedInteractionIndex(
		previous.interactionById,
		previous.interactions,
		input.graph.interactions.length
	);
	const previousBlockingInteractionId = previous.activity.blockingInteractionId ?? null;
	const nextBlockingInteractionId = input.graph.activity.blockingInteractionId ?? null;
	if (nextBlockingInteractionId === previousBlockingInteractionId) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}
	if (nextBlockingInteractionId !== null) {
		return null;
	}
	if (previousVisibleEntry === null) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries: createInsertedSceneEntryArray(
				previous.conversation.entries,
				transcriptSceneEntryCount,
				[],
				[]
			),
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex: createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[previousVisibleEntry],
			[],
			transcriptSceneEntryCount
		),
	};
}

export function materializeMarkedInteractionPatchedConversation(
	previous: CachedConversationState,
	input: CachedConversationInput,
	patchedInteractionsByIndex: ReadonlyMap<number, InteractionSnapshot> | null,
	appendedInteractions: readonly InteractionSnapshot[] | null
): CachedConversationState | null {
	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const previousVisibleEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (previousVisibleEntries.length > 1) {
		return null;
	}
	const previousVisibleEntry: AgentPanelSceneEntryModel | null =
		previousVisibleEntries[0] ?? null;
	let nextVisibleEntry: AgentPanelSceneEntryModel | null = previousVisibleEntry;
	let visibleEntryChanged = false;

	if (patchedInteractionsByIndex !== null) {
		for (const [index, interaction] of patchedInteractionsByIndex) {
			const previousInteraction = previous.interactions[index];
			if (previousInteraction === undefined || previousInteraction.id !== interaction.id) {
				return null;
			}
			const rowId = interactionSceneEntryId(interaction.id);
			const nextEntry = questionInteractionToSceneEntry(interaction, input.graph);
			if (nextEntry === null) {
				if (previousVisibleEntry?.id !== rowId) {
					continue;
				}
				nextVisibleEntry = null;
				visibleEntryChanged = true;
				continue;
			}
			if (
				nextVisibleEntry !== null &&
				nextVisibleEntry.id !== rowId &&
				previousVisibleEntry?.id !== rowId
			) {
				return null;
			}
			if (
				previousVisibleEntry !== null &&
				previousVisibleEntry.id === rowId &&
				areSceneEntriesEquivalent(previousVisibleEntry, nextEntry)
			) {
				continue;
			}
			nextVisibleEntry = nextEntry;
			visibleEntryChanged = true;
		}
	}

	if (appendedInteractions !== null) {
		for (const interaction of appendedInteractions) {
			const nextEntry = questionInteractionToSceneEntry(interaction, input.graph);
			if (nextEntry === null) {
				continue;
			}
			if (nextVisibleEntry !== null && nextVisibleEntry.id !== nextEntry.id) {
				return null;
			}
			if (
				previousVisibleEntry !== null &&
				previousVisibleEntry.id === nextEntry.id &&
				areSceneEntriesEquivalent(previousVisibleEntry, nextEntry)
			) {
				continue;
			}
			nextVisibleEntry = nextEntry;
			visibleEntryChanged = true;
		}
	}
	const interactionById = createPatchedInteractionIndex(
		previous.interactionById,
		patchedInteractionsByIndex,
		appendedInteractions
	);

	if (!visibleEntryChanged) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}

	if (previousVisibleEntry === null && nextVisibleEntry === null) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById,
			activity: input.graph.activity,
		};
	}

	let nextEntries: readonly AgentPanelSceneEntryModel[];
	let sceneEntryRowIndex: ReadonlyMap<string, number>;
	if (previousVisibleEntry === null && nextVisibleEntry !== null) {
		nextEntries = createAppendedSceneEntryArray(previous.conversation.entries, [nextVisibleEntry]);
		sceneEntryRowIndex = createAppendedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[nextVisibleEntry],
			previous.conversation.entries.length
		);
	} else if (previousVisibleEntry !== null && nextVisibleEntry === null) {
		nextEntries = createInsertedSceneEntryArray(
			previous.conversation.entries,
			transcriptSceneEntryCount,
			[],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[previousVisibleEntry],
			[],
			transcriptSceneEntryCount
		);
	} else if (
		previousVisibleEntry !== null &&
		nextVisibleEntry !== null &&
		previousVisibleEntry.id === nextVisibleEntry.id
	) {
		nextEntries = createPatchedSceneEntryArray(
			previous.conversation.entries,
			new Map([[transcriptSceneEntryCount, nextVisibleEntry]])
		);
		sceneEntryRowIndex = previous.sceneEntryRowIndex;
	} else {
		nextEntries = createInsertedSceneEntryArray(
			previous.conversation.entries,
			transcriptSceneEntryCount,
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			previousVisibleEntry === null ? [] : [previousVisibleEntry],
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			transcriptSceneEntryCount
		);
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries: nextEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex,
	};
}

