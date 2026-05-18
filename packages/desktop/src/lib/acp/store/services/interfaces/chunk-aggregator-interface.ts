/**
 * Chunk Aggregator Interface
 *
 * Narrow compatibility interface for legacy assistant/user chunk aggregation
 * and boundary management. Canonical transcript snapshots and deltas are the
 * product path.
 */

import type { ResultAsync } from "neverthrow";

import type { ContentBlock, ContentChunk } from "../../../../services/converted-session-types.js";
import type { AppError } from "../../../errors/app-error.js";
import type { IBoundaryManager } from "./boundary-manager.js";

export interface IChunkAggregator extends IBoundaryManager {
	aggregateCompatibilityAssistantChunk(
		sessionId: string,
		chunk: ContentChunk,
		messageId: string | undefined,
		isThought: boolean
	): ResultAsync<void, AppError>;

	aggregateCompatibilityUserChunk(
		sessionId: string,
		chunk: { content: ContentBlock }
	): ResultAsync<void, AppError>;

	clearStreamingAssistantEntry(sessionId: string): void;
	clearSession(sessionId: string): void;
}
