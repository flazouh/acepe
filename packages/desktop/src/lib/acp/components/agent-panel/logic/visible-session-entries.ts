import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { ErrorMessage } from "../../../types/error-message.js";

interface ResolveVisibleSessionEntriesInput {
	readonly sessionEntries: readonly SessionEntry[];
	readonly activeTurnError: ErrorMessage | null;
}

function optionalFieldMatches<T>(left: T | undefined, right: T | undefined): boolean {
	return left === undefined || right === undefined || left === right;
}

function matchesErrorMessage(left: ErrorMessage, right: ErrorMessage): boolean {
	return (
		left.content === right.content &&
		optionalFieldMatches(left.code, right.code) &&
		optionalFieldMatches(left.kind, right.kind) &&
		optionalFieldMatches(left.source, right.source)
	);
}

export function resolveVisibleSessionEntries(
	input: ResolveVisibleSessionEntriesInput
): readonly SessionEntry[] {
	if (input.activeTurnError === null) {
		return input.sessionEntries;
	}

	const lastEntry = input.sessionEntries.at(-1);
	if (lastEntry?.type !== "error") {
		return input.sessionEntries;
	}

	if (!matchesErrorMessage(lastEntry.message, input.activeTurnError)) {
		return input.sessionEntries;
	}

	return input.sessionEntries.slice(0, -1);
}
