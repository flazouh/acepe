import type { SessionEntry } from "../types.js";
import type { SessionEntryStore } from "../session-entry-store.svelte.js";
import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../errors/app-error.js";
import type {
	ContentBlock,
	ContentChunk,
	ToolCallData,
} from "../../../services/converted-session-types.js";
import type { ToolCallUpdate } from "../../types/tool-call.js";

type CompatibilityEntryStorage = {
	entriesById: {
		get(sessionId: string): SessionEntry[] | undefined;
	};
};

export function readCompatibilityEntries(
	store: SessionEntryStore,
	sessionId: string
): SessionEntry[] {
	return (store as never as CompatibilityEntryStorage).entriesById.get(sessionId) ?? [];
}

type CompatibilityEntryMutations = {
	preloadCompatibilityEntriesAndBuildIndex(sessionId: string, entries: SessionEntry[]): void;
	recordCompatibilityToolCallTranscriptEntry(sessionId: string, toolCallData: ToolCallData): void;
	updateCompatibilityToolCallTranscriptEntry(sessionId: string, update: ToolCallUpdate): void;
	aggregateCompatibilityUserChunk(
		sessionId: string,
		chunk: { content: ContentBlock }
	): ResultAsync<void, AppError>;
	aggregateCompatibilityAssistantChunk(
		sessionId: string,
		chunk: ContentChunk,
		messageId: string | undefined,
		isThought: boolean
	): ResultAsync<void, AppError>;
};

export function preloadCompatibilityEntriesAndBuildIndex(
	store: SessionEntryStore,
	sessionId: string,
	entries: SessionEntry[]
): void {
	(store as never as CompatibilityEntryMutations).preloadCompatibilityEntriesAndBuildIndex(
		sessionId,
		entries
	);
}

export function recordCompatibilityToolCallTranscriptEntry(
	store: SessionEntryStore,
	sessionId: string,
	toolCallData: ToolCallData
): void {
	(store as never as CompatibilityEntryMutations).recordCompatibilityToolCallTranscriptEntry(
		sessionId,
		toolCallData
	);
}

export function updateCompatibilityToolCallTranscriptEntry(
	store: SessionEntryStore,
	sessionId: string,
	update: ToolCallUpdate
): void {
	(store as never as CompatibilityEntryMutations).updateCompatibilityToolCallTranscriptEntry(
		sessionId,
		update
	);
}

export function aggregateCompatibilityUserChunk(
	store: SessionEntryStore,
	sessionId: string,
	chunk: { content: ContentBlock }
): ResultAsync<void, AppError> {
	return (store as never as CompatibilityEntryMutations).aggregateCompatibilityUserChunk(
		sessionId,
		chunk
	);
}

export function aggregateCompatibilityAssistantChunk(
	store: SessionEntryStore,
	sessionId: string,
	chunk: ContentChunk,
	messageId: string | undefined,
	isThought: boolean
): ResultAsync<void, AppError> {
	return (store as never as CompatibilityEntryMutations).aggregateCompatibilityAssistantChunk(
		sessionId,
		chunk,
		messageId,
		isThought
	);
}
