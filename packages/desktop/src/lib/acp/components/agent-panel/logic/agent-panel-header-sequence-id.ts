/**
 * Resolves the sequence id shown in agent panel header chrome.
 *
 * Today only session metadata is consulted — pending creation identity is ignored.
 */
export function resolveAgentPanelHeaderSequenceId(input: {
	readonly sessionMetadataSequenceId: number | null | undefined;
	readonly pendingCreationSequenceId: number | null | undefined;
	readonly hasPendingCreationSession: boolean;
}): number | null {
	if (input.sessionMetadataSequenceId != null) {
		return input.sessionMetadataSequenceId;
	}

	if (
		input.hasPendingCreationSession &&
		input.pendingCreationSequenceId != null
	) {
		return input.pendingCreationSequenceId;
	}

	return null;
}
