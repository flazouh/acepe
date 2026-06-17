import type { TranscriptEntry, TranscriptSnapshot } from "../../../services/acp-types.js";
import { segmentText } from "../../session-state/transcript-text.js";
import type { SessionPendingSendIntent } from "../types.js";

function transcriptSnapshotContainsUserAttemptId(
	snapshot: TranscriptSnapshot,
	attemptId: string
): boolean {
	for (const entry of snapshot.entries) {
		if (entry.role === "user" && entry.attemptId === attemptId) {
			return true;
		}
	}

	return false;
}

function transcriptEntryText(entry: TranscriptEntry): string {
	return segmentText(entry);
}

function pendingSendText(pendingSendIntent: SessionPendingSendIntent): string | null {
	if (pendingSendIntent.optimisticEntry.type !== "user") {
		return null;
	}
	const content = pendingSendIntent.optimisticEntry.message.content;
	if (content.type !== "text") {
		return null;
	}
	return content.text.trim();
}

export function transcriptSnapshotAcknowledgesPendingSend(
	snapshot: TranscriptSnapshot,
	pendingSendIntent: SessionPendingSendIntent
): boolean {
	if (transcriptSnapshotContainsUserAttemptId(snapshot, pendingSendIntent.attemptId)) {
		return true;
	}

	if (
		pendingSendIntent.baselineTranscriptRevision === null ||
		snapshot.revision <= pendingSendIntent.baselineTranscriptRevision
	) {
		return false;
	}

	const expectedText = pendingSendText(pendingSendIntent);
	if (expectedText === null || expectedText.length === 0) {
		return false;
	}

	for (const entry of snapshot.entries) {
		if (entry.role === "user" && transcriptEntryText(entry).trim() === expectedText) {
			return true;
		}
	}

	return false;
}

export function pendingSendIntentClearUpdate(
	snapshot: TranscriptSnapshot,
	pendingSendIntent: SessionPendingSendIntent | null | undefined
): { pendingSendIntent: null } | null {
	if (
		pendingSendIntent !== null &&
		pendingSendIntent !== undefined &&
		transcriptSnapshotAcknowledgesPendingSend(snapshot, pendingSendIntent)
	) {
		return { pendingSendIntent: null };
	}

	return null;
}
