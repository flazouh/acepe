export function resolveSequenceIdBackfillForExistingSession(input: {
	readonly metadataSequenceId: number | null | undefined;
	readonly graphSequenceId: number | null | undefined;
	readonly pendingSequenceId: number | null | undefined;
}): number | null {
	if (input.metadataSequenceId != null) {
		return null;
	}

	if (input.graphSequenceId != null) {
		return input.graphSequenceId;
	}

	return input.pendingSequenceId ?? null;
}
