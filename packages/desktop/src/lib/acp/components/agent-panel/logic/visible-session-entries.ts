import type { SessionEntry } from "../../../application/dto/session.js";
import type { ErrorMessage } from "../../../types/error-message.js";

interface ResolveVisibleSessionEntriesInput {
	readonly sessionEntries: readonly SessionEntry[];
	readonly showInlineErrorCard: boolean;
	readonly activeTurnError: ErrorMessage | null;
}

function matchesActiveTurnError(
	entryMessage: ErrorMessage,
	activeTurnError: ErrorMessage
): boolean {
	return (
		entryMessage.content === activeTurnError.content &&
		entryMessage.kind === activeTurnError.kind &&
		entryMessage.code === activeTurnError.code
	);
}

export function resolveVisibleSessionEntries(
	input: ResolveVisibleSessionEntriesInput
): readonly SessionEntry[] {
	if (!input.showInlineErrorCard || input.activeTurnError === null) {
		return input.sessionEntries;
	}

	const lastEntry = input.sessionEntries.at(-1);
	if (!lastEntry || lastEntry.type !== "error") {
		return input.sessionEntries;
	}

	if (!matchesActiveTurnError(lastEntry.message, input.activeTurnError)) {
		return input.sessionEntries;
	}

	let lastVisibleIndex = input.sessionEntries.length - 1;
	while (lastVisibleIndex >= 0) {
		const entry = input.sessionEntries[lastVisibleIndex];
		if (entry?.type !== "error") {
			break;
		}
		if (!matchesActiveTurnError(entry.message, input.activeTurnError)) {
			break;
		}
		lastVisibleIndex -= 1;
	}

	return input.sessionEntries.slice(0, lastVisibleIndex + 1);
}
