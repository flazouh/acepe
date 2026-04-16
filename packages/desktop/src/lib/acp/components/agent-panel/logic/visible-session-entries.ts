import type { SessionEntry } from "../../../application/dto/session.js";
import type { ErrorMessage } from "../../../types/error-message.js";

interface ResolveVisibleSessionEntriesInput {
	readonly sessionEntries: readonly SessionEntry[];
	readonly activeTurnError: ErrorMessage | null;
}

function canonicalErrorSource(source: ErrorMessage["source"]): string {
	return source ?? "unknown";
}

function matchesErrorMessage(left: ErrorMessage, right: ErrorMessage): boolean {
	return (
		left.content === right.content &&
		left.code === right.code &&
		left.kind === right.kind &&
		canonicalErrorSource(left.source) === canonicalErrorSource(right.source)
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
