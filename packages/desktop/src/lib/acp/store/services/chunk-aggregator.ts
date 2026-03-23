/**
 * Chunk Aggregator - Manages assistant/user chunk aggregation and boundary splitting.
 *
 * Extracted from SessionEntryStore to isolate chunk aggregation concerns.
 * Core decision logic delegates to pure functions (resolveChunkAction, normalizeChunk)
 * for maximum testability.
 *
 * All dependencies are injected via interfaces for testability.
 */

import { err, errAsync, ok, okAsync, type Result, type ResultAsync } from "neverthrow";
import type { ContentBlock } from "../../../services/converted-session-types.js";
import type { AppError } from "../../errors/app-error.js";
import {
	createInitialState,
	resolveChunkAction,
	splitBoundary,
} from "../../logic/chunk-action-resolver.js";
import type { AggregationState } from "../../logic/chunk-aggregation-types.js";
import type { AssistantMessage, AssistantMessageChunk } from "../../types/assistant-message.js";
import type { UserMessage } from "../../types/user-message.js";
import { createLogger } from "../../utils/logger.js";
import type { SessionEntry } from "../types.js";
import type { IChunkAggregator } from "./interfaces/chunk-aggregator-interface.js";
import type { IEntryIndex } from "./interfaces/entry-index.js";
import type { IEntryStoreInternal } from "./interfaces/entry-store-internal.js";

const logger = createLogger({ id: "chunk-aggregator", name: "ChunkAggregator" });

import { SessionNotFoundError, ValidationError } from "../../errors/app-error.js";
import { MessageProcessor } from "../../logic/message-processor.js";
import { normalizeChunk } from "../../logic/normalize-chunk.js";
import {
	type AssistantChunkInput,
	AssistantChunkInputSchema,
} from "../../schemas/message-chunk.schema.js";
/**
 * Manages chunk aggregation with pure function decision logic.
 *
 * Owns per-session AggregationState that replaces the previous
 * missingMessageIdTracker, pendingAssistantBoundaries, and postBoundaryMessageIdMap.
 */
export class ChunkAggregator implements IChunkAggregator {
	private readonly aggregationStates = new Map<string, AggregationState>();
	private readonly messageProcessor: MessageProcessor;

	constructor(
		private readonly entryStore: IEntryStoreInternal,
		private readonly entryIndex: IEntryIndex,
		messageProcessor?: MessageProcessor
	) {
		this.messageProcessor = messageProcessor ?? new MessageProcessor();
	}

	// ============================================
	// PUBLIC: IChunkAggregator
	// ============================================

	/**
	 * Aggregate assistant chunk into appropriate entry or create new one.
	 */
	aggregateAssistantChunk(
		sessionId: string,
		chunk: { content: ContentBlock },
		messageId: string | undefined,
		isThought: boolean
	): ResultAsync<void, AppError> {
		const validationResult = this.validateChunkInput(sessionId, chunk, messageId, isThought);
		if (validationResult.isErr()) {
			return errAsync(validationResult.error);
		}

		const input = validationResult.value;

		if (!this.entryStore.hasSession(sessionId)) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		return this.processChunk(sessionId, input);
	}

	/**
	 * Aggregate user chunk into latest user entry or create a new one.
	 */
	aggregateUserChunk(
		sessionId: string,
		chunk: { content: ContentBlock }
	): ResultAsync<void, AppError> {
		if (!this.entryStore.hasSession(sessionId)) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		const existingEntry = this.findLatestUserEntryRef(sessionId);

		if (existingEntry) {
			if (this.isDuplicateMirroredUserChunk(existingEntry.entry.message, chunk.content)) {
				logger.debug("Dropping mirrored user chunk after optimistic entry", {
					sessionId,
					entryId: existingEntry.entry.id,
				});
				return okAsync(undefined);
			}

			const mergedMessage = this.messageProcessor.mergeUserMessageChunk(
				existingEntry.entry.message,
				{ content: chunk.content }
			);

			const updatedEntry: SessionEntry = {
				...existingEntry.entry,
				message: mergedMessage,
			};

			this.entryStore.updateEntry(sessionId, existingEntry.index, updatedEntry);

			return okAsync(undefined);
		}

		const newEntry: SessionEntry = {
			id: crypto.randomUUID(),
			type: "user",
			message: {
				content: chunk.content,
				chunks: [chunk.content],
			},
			timestamp: new Date(),
		};

		this.entryStore.addEntry(sessionId, newEntry);
		return okAsync(undefined);
	}

	/**
	 * Force subsequent assistant chunks to start a new entry (IBoundaryManager).
	 *
	 * Called before tool call creation/update to prevent a single assistant entry
	 * from spanning "thought/tool/message" phases.
	 */
	splitAssistantAggregationBoundary(sessionId: string): void {
		const state = this.getState(sessionId);
		this.setState(sessionId, splitBoundary(state));
	}

	/**
	 * Clear in-progress assistant streaming aggregation state.
	 */
	clearStreamingAssistantEntry(sessionId: string): void {
		this.aggregationStates.delete(sessionId);
	}

	/**
	 * Clear all state for a session.
	 */
	clearSession(sessionId: string): void {
		this.aggregationStates.delete(sessionId);
	}

	// ============================================
	// PRIVATE: Core processing
	// ============================================

	private processChunk(sessionId: string, input: AssistantChunkInput): ResultAsync<void, AppError> {
		const state = this.getState(sessionId);
		const textPreview =
			input.content.type === "text" ? input.content.text.slice(0, 30) : `[${input.content.type}]`;

		logger.debug("Processing chunk", {
			sessionId,
			messageId: input.messageId,
			lastKnownMessageId: state.lastKnownMessageId,
			textPreview,
			isThought: input.isThought,
		});

		const { decision, nextState } = resolveChunkAction(
			state,
			{
				messageId: input.messageId,
				content: input.content as ContentBlock,
				isThought: input.isThought,
			},
			(id) => this.assistantEntryExists(sessionId, id)
		);

		logger.debug("Chunk decision", {
			sessionId,
			action: decision.action,
			entryId: decision.entryId,
			boundaryConsumed: "boundaryConsumed" in decision ? decision.boundaryConsumed : undefined,
		});

		this.setState(sessionId, nextState);

		return this.applyDecision(sessionId, decision, input);
	}

	private applyDecision(
		sessionId: string,
		decision: ReturnType<typeof resolveChunkAction>["decision"],
		input: AssistantChunkInput
	): ResultAsync<void, AppError> {
		switch (decision.action) {
			case "merge": {
				const existing = this.findAssistantEntryRef(sessionId, decision.entryId);
				if (existing) {
					this.mergeChunkIntoEntry(sessionId, existing, input);
					return okAsync(undefined);
				}
				// Entry disappeared between decision and apply — fall through to create
				logger.warn("Entry disappeared during merge, creating new entry", {
					sessionId,
					targetEntryId: decision.entryId,
					inputMessageId: input.messageId,
				});
				return this.createAssistantEntry(sessionId, decision.entryId, input);
			}

			case "create":
				return this.createAssistantEntry(sessionId, decision.entryId, input);
		}
	}

	// ============================================
	// PRIVATE: Entry operations
	// ============================================

	private createAssistantEntry(
		sessionId: string,
		entryId: string,
		input: AssistantChunkInput
	): ResultAsync<void, AppError> {
		const normalized = normalizeChunk({
			messageId: input.messageId,
			content: input.content as ContentBlock,
			isThought: input.isThought,
		});

		const newChunk: AssistantMessageChunk = {
			type: normalized.type,
			block: normalized.block,
		};

		const newEntry: SessionEntry = {
			id: entryId,
			type: "assistant",
			message: { chunks: [newChunk] },
			timestamp: new Date(),
		};

		this.entryStore.addEntry(sessionId, newEntry);
		return okAsync(undefined);
	}

	private mergeChunkIntoEntry(
		sessionId: string,
		existing: EntryRef,
		input: AssistantChunkInput
	): void {
		const message = existing.entry.message as AssistantMessage;
		const textPreview =
			input.content.type === "text" ? input.content.text.slice(0, 50) : `[${input.content.type}]`;

		logger.debug("Merging chunk into entry", {
			sessionId,
			entryId: existing.entry.id,
			entryIndex: existing.index,
			existingChunkCount: message.chunks.length,
			newChunkPreview: textPreview,
			isThought: input.isThought,
		});

		// Append as new chunk
		const mergedMessage = this.messageProcessor.mergeAssistantMessageChunk(
			message,
			{ content: input.content as ContentBlock },
			input.isThought
		);

		const updatedEntry: SessionEntry = {
			id: existing.entry.id,
			type: "assistant" as const,
			message: mergedMessage,
			timestamp: existing.entry.timestamp,
			isStreaming: existing.entry.isStreaming,
		};

		logger.debug("Writing merged entry", {
			sessionId,
			entryId: updatedEntry.id,
			newChunkCount: mergedMessage.chunks.length,
		});

		this.writeEntry(sessionId, existing, updatedEntry);
	}

	// ============================================
	// PRIVATE: Helpers
	// ============================================

	private validateChunkInput(
		sessionId: string,
		chunk: { content: ContentBlock },
		messageId: string | undefined,
		isThought: boolean
	): Result<AssistantChunkInput, AppError> {
		const parseResult = AssistantChunkInputSchema.safeParse({
			sessionId,
			messageId,
			content: chunk.content,
			isThought,
		});

		if (!parseResult.success) {
			return err(new ValidationError("Invalid chunk input", undefined, parseResult.error));
		}

		return ok(parseResult.data);
	}

	/** Find an assistant entry by ID. */
	private findAssistantEntryRef(sessionId: string, entryId: string): EntryRef | null {
		const entries = this.entryStore.getEntries(sessionId);
		const idx = entries.findIndex((entry) => entry.type === "assistant" && entry.id === entryId);
		if (idx !== -1) {
			this.entryIndex.addMessageId(sessionId, entryId, idx);
			logger.debug("Found entry", { sessionId, entryId, index: idx });
			return { entry: entries[idx], index: idx };
		}

		logger.debug("Entry not found", { sessionId, entryId });
		return null;
	}

	/** Check if an assistant entry exists. */
	private assistantEntryExists(sessionId: string, entryId: string): boolean {
		const entries = this.entryStore.getEntries(sessionId);
		return entries.some((entry) => entry.type === "assistant" && entry.id === entryId);
	}

	/** Find the latest user entry. */
	private findLatestUserEntryRef(
		sessionId: string
	): (EntryRef & { entry: SessionEntry & { type: "user" } }) | null {
		const entries = this.entryStore.getEntries(sessionId);
		if (entries.length === 0) {
			return null;
		}

		const latestIndex = entries.length - 1;
		const latest = entries[latestIndex];
		if (latest.type === "user") {
			return { entry: latest, index: latestIndex };
		}

		return null;
	}

	private isDuplicateMirroredUserChunk(
		existingMessage: UserMessage,
		incoming: ContentBlock
	): boolean {
		if (existingMessage.chunks.length !== 1) {
			return false;
		}
		const firstChunk = existingMessage.chunks[0];
		return this.contentBlocksEqual(firstChunk, incoming);
	}

	private contentBlocksEqual(left: ContentBlock, right: ContentBlock): boolean {
		if (left.type !== right.type) {
			return false;
		}
		if (left.type === "text" && right.type === "text") {
			return left.text === right.text;
		}
		return JSON.stringify(left) === JSON.stringify(right);
	}

	private getState(sessionId: string): AggregationState {
		return this.aggregationStates.get(sessionId) ?? createInitialState();
	}

	private setState(sessionId: string, state: AggregationState): void {
		this.aggregationStates.set(sessionId, state);
	}

	private writeEntry(sessionId: string, ref: EntryRef, updatedEntry: SessionEntry): void {
		this.entryStore.updateEntry(sessionId, ref.index, updatedEntry);
	}
}

/** Reference to an entry with its location metadata. */
interface EntryRef {
	readonly entry: SessionEntry;
	readonly index: number;
}
