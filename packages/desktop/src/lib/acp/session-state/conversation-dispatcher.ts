/**
 * Conversation dispatcher for the agent-panel materializer: given the prior
 * cached conversation state + the new canonical input, select the cheapest
 * valid re-materialization path (reuse → activity-only → operation/streaming/
 * transcript/interaction patch fast paths → full rebuild). Pure orchestration.
 */
import type {
	CachedConversationInput,
	CachedConversationState,
} from "./conversation-cache-types.js";
import {
	canReuseConversation,
	canReuseConversationEntriesWithUpdatedActivity,
	materializeConversationWithOperationIndex,
} from "./conversation-rebuild.js";
import {
	materializeBlockingInteractionRetargetConversation,
	materializeInteractionPatchedConversation,
} from "./interaction-patch-conversations.js";
import { materializeOperationPatchedConversation } from "./operation-patch-conversations.js";
import {
	materializeStreamingStatePatchedConversation,
	materializeTranscriptAppendedConversation,
	materializeTranscriptArrayPatchedConversation,
	materializeTranscriptPatchedAndAppendedConversation,
	materializeTranscriptPatchedConversation,
	materializeTranscriptTruncatedConversation,
} from "./transcript-patch-conversations.js";
import { buildOperationIndex } from "./operation-index.js";
import { buildInteractionIndex, buildTranscriptEntryIndex } from "./transcript-interaction-index.js";
import { buildSceneEntryRowIndex } from "./scene-entry-row-index.js";

export function materializeCachedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState {
	if (canReuseConversation(previous, input)) {
		return previous;
	}

	if (canReuseConversationEntriesWithUpdatedActivity(previous, input)) {
		const blockingInteractionRetarget = materializeBlockingInteractionRetargetConversation(
			previous,
			input
		);
		if (blockingInteractionRetarget !== null) {
			return blockingInteractionRetarget;
		}
		const cachedConversation = previous as CachedConversationState;
		return {
			...cachedConversation,
			activity: input.graph.activity,
		};
	}

	const operationPatched = materializeOperationPatchedConversation(previous, input);
	if (operationPatched !== null) {
		return operationPatched;
	}

	const streamingStatePatched = materializeStreamingStatePatchedConversation(previous, input);
	if (streamingStatePatched !== null) {
		return streamingStatePatched;
	}

	const transcriptArrayPatched = materializeTranscriptArrayPatchedConversation(previous, input);
	if (transcriptArrayPatched !== null) {
		return transcriptArrayPatched;
	}

	const transcriptPatchedAndAppended = materializeTranscriptPatchedAndAppendedConversation(
		previous,
		input
	);
	if (transcriptPatchedAndAppended !== null) {
		return transcriptPatchedAndAppended;
	}

	const transcriptPatched = materializeTranscriptPatchedConversation(previous, input);
	if (transcriptPatched !== null) {
		return transcriptPatched;
	}

	const transcriptTruncated = materializeTranscriptTruncatedConversation(previous, input);
	if (transcriptTruncated !== null) {
		return transcriptTruncated;
	}

	const transcriptAppended = materializeTranscriptAppendedConversation(previous, input);
	if (transcriptAppended !== null) {
		return transcriptAppended;
	}

	const interactionPatched = materializeInteractionPatchedConversation(previous, input);
	if (interactionPatched !== null) {
		return interactionPatched;
	}

	const operationIndex = buildOperationIndex(input.graph.operations);
	const conversation = materializeConversationWithOperationIndex(input.graph, operationIndex);
	return {
		// conversation already carries scenePatch from the full rebuild path
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex,
		interactions: input.graph.interactions,
		interactionById: buildInteractionIndex(input.graph.interactions),
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: buildTranscriptEntryIndex(input.graph.transcriptSnapshot.entries),
		conversation,
		sceneEntryRowIndex: buildSceneEntryRowIndex(conversation.entries),
	};
}

