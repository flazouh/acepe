/**
 * Chunk Aggregator Interface
 *
 * Narrow interface for assistant/user chunk aggregation and boundary management.
 * ChunkAggregator implements this (extends IBoundaryManager); the store facade consumes it.
 */

import type { ResultAsync } from "neverthrow";

import type { ContentBlock } from "../../../../services/converted-session-types.js";
import type { AppError } from "../../../errors/app-error.js";
import type { IBoundaryManager } from "./boundary-manager.js";

export interface IChunkAggregator extends IBoundaryManager {
	aggregateAssistantChunk(
		sessionId: string,
		chunk: { content: ContentBlock },
		messageId: string | undefined,
		isThought: boolean
	): ResultAsync<void, AppError>;

	aggregateUserChunk(
		sessionId: string,
		chunk: { content: ContentBlock }
	): ResultAsync<void, AppError>;

	clearStreamingAssistantEntry(sessionId: string): void;
	clearSession(sessionId: string): void;
}
