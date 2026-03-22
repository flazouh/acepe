import { ResultAsync } from "neverthrow";

import type { SessionCold, SessionEntry } from "../../../application/dto/session";

import { ClipboardError } from "../errors";

/**
 * Data needed to copy a session to clipboard.
 */
interface ClipboardSessionData extends SessionCold {
	readonly entries: ReadonlyArray<SessionEntry>;
	readonly entryCount: number;
}

/**
 * Copies session content to clipboard as formatted JSON.
 *
 * @param session - Session cold data + entries to copy
 * @returns Result indicating success or failure
 *
 * @example
 * ```ts
 * copySessionToClipboard({ ...cold, entries, entryCount: entries.length }).match(
 *   () => console.log("Copied!"),
 *   (err) => console.error("Failed:", err)
 * );
 * ```
 */
export function copySessionToClipboard(
	session: ClipboardSessionData
): ResultAsync<void, ClipboardError> {
	const content = JSON.stringify(session, null, 2);

	return ResultAsync.fromPromise(
		navigator.clipboard.writeText(content),
		(error) =>
			new ClipboardError("Failed to copy to clipboard", {
				contentLength: content.length,
				originalError: String(error),
			})
	);
}
