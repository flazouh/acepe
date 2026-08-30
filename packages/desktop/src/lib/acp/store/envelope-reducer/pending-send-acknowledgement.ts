/**
 * Canonical acknowledgement of a local optimistic send.
 *
 * `pendingSendIntent` holds the optimistic user row the composer paints the
 * moment the send button is pressed. It is a local affordance, so something
 * canonical has to retire it. Until this module existed only two things did:
 * a turn-terminal transition and a 90s timeout. A provider that answers
 * without moving `lastTerminalTurnId` left the optimistic row on screen, and
 * `hasLocalPendingSendIntent` kept driving connection phase and tab urgency,
 * for the whole 90 seconds.
 *
 * The match reads canonical transcript facts only, and it runs in the reducer
 * so both the snapshot path and the delta path retire the intent the same way.
 *
 * Two shapes of acknowledgement, in order:
 *
 * 1. `attemptId`. Rust echoes the send attempt id back on the canonical user
 *    entry. An exact match is proof the canonical transcript carries this
 *    exact send, so nothing else is needed.
 * 2. A new user entry carrying the same text, for providers whose canonical
 *    user entries have no attempt id at all. It is deliberately narrow: the
 *    entry must be absent from the previous canonical entries, the transcript
 *    revision must have advanced past the revision recorded at send time, and
 *    the entry must carry no attempt id of its own. An entry that DOES carry
 *    an attempt id and still does not match belongs to another send, so it
 *    never acknowledges by text.
 */
import type { TranscriptEntry } from "../../../services/acp-types.js";
import { isUserEntry } from "../../application/dto/session-entry.js";
import type { SessionPendingSendIntent } from "../types.js";

function transcriptEntryText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		if (segment.kind === "text") {
			text += segment.text;
		}
	}
	return text;
}

function pendingSendIntentText(pendingSendIntent: SessionPendingSendIntent): string {
	const optimisticEntry = pendingSendIntent.optimisticEntry;
	if (!isUserEntry(optimisticEntry)) {
		return "";
	}

	let text = "";
	for (const chunk of optimisticEntry.message.chunks) {
		if (chunk.type === "text") {
			text += chunk.text;
		}
	}
	return text;
}

function matchesAttemptId(entry: TranscriptEntry, attemptId: string): boolean {
	return entry.role === "user" && entry.attemptId === attemptId;
}

function acknowledgesByText(input: {
	readonly entry: TranscriptEntry;
	readonly previousEntryIds: ReadonlySet<string>;
	readonly promptText: string;
}): boolean {
	const entry = input.entry;
	if (entry.role !== "user") {
		return false;
	}
	if (entry.attemptId != null) {
		return false;
	}
	if (input.previousEntryIds.has(entry.entryId)) {
		return false;
	}
	if (input.promptText.length === 0) {
		return false;
	}

	return transcriptEntryText(entry) === input.promptText;
}

/**
 * The attempt id the canonical transcript just acknowledged, or null when it
 * acknowledged nothing.
 */
export function acknowledgedPendingSendAttemptId(input: {
	readonly pendingSendIntent: SessionPendingSendIntent | null | undefined;
	readonly entries: readonly TranscriptEntry[];
	readonly previousEntries: readonly TranscriptEntry[];
	readonly transcriptRevision: number;
}): string | null {
	const pendingSendIntent = input.pendingSendIntent;
	if (pendingSendIntent == null) {
		return null;
	}

	for (const entry of input.entries) {
		if (matchesAttemptId(entry, pendingSendIntent.attemptId)) {
			return pendingSendIntent.attemptId;
		}
	}

	const baselineTranscriptRevision = pendingSendIntent.baselineTranscriptRevision;
	if (
		baselineTranscriptRevision !== null &&
		input.transcriptRevision <= baselineTranscriptRevision
	) {
		return null;
	}

	const previousEntryIds = new Set(input.previousEntries.map((entry) => entry.entryId));
	const promptText = pendingSendIntentText(pendingSendIntent);
	for (const entry of input.entries) {
		if (acknowledgesByText({ entry, previousEntryIds, promptText })) {
			return pendingSendIntent.attemptId;
		}
	}

	return null;
}
