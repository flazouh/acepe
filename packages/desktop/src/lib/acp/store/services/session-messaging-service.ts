/**
 * Session Messaging Service - Handles message sending and streaming.
 *
 * Responsibilities:
 * - Message sending with optimistic updates
 * - Streaming response handling
 * - Tool call management
 * - Chunk aggregation
 *
 * This service is extracted from SessionStore to separate concerns
 * and reduce the God class anti-pattern.
 */

import { errAsync, type ResultAsync } from "neverthrow";
import type { ContentBlock, ToolCallData } from "../../../services/converted-session-types.js";
import { isInlineImageAttachment } from "../../components/agent-input/logic/image-attachment.js";
import type { Attachment } from "../../components/agent-input/types/attachment.js";
import type { AppError } from "../../errors/app-error.js";
import { AgentError, ConnectionError, SessionNotFoundError } from "../../errors/app-error.js";
import { getErrorCauseDetails } from "../../errors/error-cause-details.js";
import { aggregateFileEdits } from "../../logic/aggregate-file-edits.js";
import { ConnectionState } from "../../logic/session-machine.js";
import type { AvailableCommand } from "../../types/available-command.js";
import type { ToolCallUpdate } from "../../types/tool-call.js";
import type { TurnErrorPayload } from "../../types/turn-error.js";
import { normalizeTurnError } from "../../types/turn-error.js";
import { createLogger } from "../../utils/logger.js";
import { api } from "../api.js";
import { checkpointStore } from "../checkpoint-store.svelte.js";
import { serializeWithAttachments } from "../message-queue/message-queue-store.svelte.js";
import type { SessionEntry } from "../types.js";
import type {
	IConnectionManager,
	IEntryManager,
	IHotStateManager,
	ISessionStateReader,
} from "./interfaces/index.js";

const logger = createLogger({ id: "session-messaging-service", name: "SessionMessagingService" });

/**
 * Service for messaging and streaming operations.
 */
export class SessionMessagingService {
	/**
	 * Tracks the total edit count at last checkpoint per session.
	 * Used to avoid creating duplicate checkpoints when no new edits occurred.
	 */
	private lastCheckpointEditCount = new Map<string, number>();

	constructor(
		private readonly stateReader: ISessionStateReader,
		private readonly hotStateManager: IHotStateManager,
		private readonly entryManager: IEntryManager,
		private readonly connectionManager: IConnectionManager
	) {}

	// ============================================
	// MESSAGING
	// ============================================

	/**
	 * Send a message to a session.
	 *
	 * Note: This is fire-and-forget. The prompt is sent immediately but the response
	 * arrives via Tauri events (handleStreamEntry, handleStreamComplete).
	 * Stream completion is NOT triggered here - it happens when the event system
	 * signals completion.
	 */
	sendMessage(
		sessionId: string,
		content: string,
		attachments: readonly Attachment[] = []
	): ResultAsync<void, AppError> {
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const hotState = this.stateReader.getHotState(sessionId);
		if (!hotState.isConnected) {
			return errAsync(new ConnectionError(sessionId));
		}

		// Separate inline image attachments (clipboard pastes with base64 content, no path)
		// Uses the same predicate as message-preparation.ts to prevent double-send
		const imageAttachments = attachments.filter(isInlineImageAttachment);
		const otherAttachments = attachments.filter((a) => !isInlineImageAttachment(a));

		// Serialize non-image attachments as text tokens (backward compatible)
		const textContent = serializeWithAttachments(content, otherAttachments).trim();
		if (!textContent && imageAttachments.length === 0) {
			logger.warn("Attempted to send empty message, ignoring", { sessionId });
			return errAsync(new AgentError("sendMessage: cannot send empty message"));
		}

		// Clear streaming state from previous response to prevent messageId tracker
		// from returning stale IDs when new response starts (fixes garbled text bug)
		this.entryManager.clearStreamingAssistantEntry(sessionId);

		const textBlock = { type: "text" as const, text: textContent };
		const imageBlocks = imageAttachments
			.map((img) => {
				const parsed = parseDataUrl(img.content!);
				if (!parsed) return null;
				return { type: "image" as const, data: parsed.data, mimeType: parsed.mimeType };
			})
			.filter((b): b is Extract<ContentBlock, { type: "image" }> => b !== null);
		const userEntry: SessionEntry = {
			id: crypto.randomUUID(),
			type: "user",
			message: {
				content: textBlock,
				chunks: [...imageBlocks, textBlock],
				sentAt: new Date(),
			},
			timestamp: new Date(),
		};

		this.entryManager.addEntry(sessionId, userEntry);
		logger.info("sendMessage: optimistic user entry added", {
			sessionId,
			entryId: userEntry.id,
			entryType: userEntry.type,
			entryCount: this.stateReader.getEntries(sessionId).length,
			preview: textContent.slice(0, 120),
			imageCount: imageAttachments.length,
		});

		// Start awaiting response in state machine
		this.connectionManager.sendMessageSent(sessionId);

		this.hotStateManager.updateHotState(sessionId, {
			status: "streaming",
			turnState: "streaming",
			connectionError: null, // Clear any previous turn error
		});
		logger.debug("Sending message (optimistic)", { sessionId });

		// Build content blocks: image blocks first, then text block
		// @[text:BASE64] tokens are expanded to <pasted-content> blocks by the Rust
		// Tauri layer (attachment_token_expander) before reaching any agent backend.
		const contentBlocks: Array<{ type: string; text?: string; data?: string; mimeType?: string }> =
			[
				...imageBlocks.map((b) => ({ type: b.type, data: b.data, mimeType: b.mimeType })),
				...(textContent ? [{ type: "text", text: textContent }] : []),
			];

		return api
			.sendPrompt(sessionId, contentBlocks)
			.map(() => {
				// Prompt sent successfully - response will arrive via Tauri events
				// DO NOT call stream complete here - sendPrompt is fire-and-forget
				logger.debug("Message sent successfully", { sessionId });
			})
			.mapErr((error) => {
				this.entryManager.removeEntry(sessionId, userEntry.id);
				// Transition XState machine to ERROR (fatal) — subprocess is dead, can't
				// accept messages. Must pair machine event with hot-state update per the
				// reactive anchor pattern to prevent stuck UI.
				this.connectionManager.sendTurnFailed(sessionId, {
					kind: "fatal",
					message: error.message,
				});
				this.hotStateManager.updateHotState(sessionId, {
					status: "error",
					turnState: "error",
					connectionError: error.message,
				});
				logger.error("Failed to send message, rolling back", {
					sessionId,
					error,
				});
				return error;
			});
	}

	// ============================================
	// STREAMING
	// ============================================

	/**
	 * Handle incoming stream entry from Tauri events.
	 */
	handleStreamEntry(sessionId: string, entry: SessionEntry): void {
		// Transition from awaiting response to streaming on ANY entry type.
		// This hides the "Thinking_" indicator as soon as the agent starts responding
		// (whether with assistant text, tool calls, or ask prompts).
		// The machine transition synchronously updates the SvelteMap snapshot cache,
		// so $derived consumers re-evaluate automatically.
		const state = this.connectionManager.getState(sessionId);
		if (state && state.connection === "awaitingResponse") {
			this.connectionManager.sendResponseStarted(sessionId);
		}

		this.entryManager.addEntry(sessionId, entry);
		logger.debug("handleStreamEntry: stream entry added", {
			sessionId,
			entryId: entry.id,
			entryType: entry.type,
			entryCount: this.stateReader.getEntries(sessionId).length,
		});
	}

	/**
	 * Handle stream complete from Tauri events.
	 */
	handleStreamComplete(sessionId: string): void {
		const hotState = this.hotStateManager.getHotState(sessionId);
		if (hotState?.turnState === "completed") {
			return;
		}

		// Intentionally do NOT clear assistant chunk aggregation state here.
		// Some providers can emit trailing assistant chunks after turnComplete,
		// and those chunks may omit message_id. Keeping the last known tracker
		// prevents fragmented one-word assistant entries.
		// Complete streaming in state machine
		this.connectionManager.sendResponseComplete(sessionId);

		this.hotStateManager.updateHotState(sessionId, {
			status: "ready",
			turnState: "completed",
		});

		// Mark any still-streaming tool call entries as not streaming
		// so pending tools stop shimmering in the queue and thread views.
		this.entryManager.finalizeStreamingEntries(sessionId);

		logger.info("Stream completed - checking for auto-checkpoint", { sessionId });

		// Create auto-checkpoint if files were modified
		this.createAutoCheckpointIfNeeded(sessionId);
	}

	/**
	 * Create an auto-checkpoint if NEW files were modified during this turn.
	 * Tracks edit count to avoid duplicate checkpoints.
	 */
	private createAutoCheckpointIfNeeded(sessionId: string): void {
		const session = this.stateReader.getSessionCold(sessionId);
		if (!session?.projectPath) {
			logger.warn("Auto-checkpoint skipped: no projectPath", {
				sessionId,
				hasSession: !!session,
				projectPath: session?.projectPath ?? null,
			});
			return;
		}

		const entries = this.stateReader.getEntries(sessionId);
		const modifiedFilesState = aggregateFileEdits(entries);
		if (modifiedFilesState.fileCount === 0) {
			logger.info("Auto-checkpoint skipped: no edit entries found", {
				sessionId,
				totalEntries: entries.length,
				toolCallEntries: entries.filter((e) => e.type === "tool_call").length,
			});
			return;
		}

		// Skip if no new edits occurred since last checkpoint
		const lastEditCount = this.lastCheckpointEditCount.get(sessionId) ?? 0;
		if (modifiedFilesState.totalEditCount <= lastEditCount) {
			logger.info("Auto-checkpoint skipped: no new edits since last checkpoint", {
				sessionId,
				totalEditCount: modifiedFilesState.totalEditCount,
				lastEditCount,
			});
			return;
		}

		// Pass absolute paths directly - Rust backend handles conversion
		const modifiedFilePaths = modifiedFilesState.files
			.map((f) => f.filePath)
			.filter((p) => p.length > 0);

		if (modifiedFilePaths.length === 0) {
			logger.warn("Auto-checkpoint skipped: no valid file paths after filtering", {
				sessionId,
				files: modifiedFilesState.files.map((f) => ({
					path: f.filePath,
					editCount: f.editCount,
				})),
			});
			return;
		}

		logger.info("Creating auto-checkpoint", {
			sessionId,
			fileCount: modifiedFilePaths.length,
			filePaths: modifiedFilePaths,
			projectPath: session.projectPath,
		});

		// Auto-checkpoint (fire-and-forget - failure logged but not propagated)
		checkpointStore
			.createCheckpoint(sessionId, session.projectPath, modifiedFilePaths, {
				isAuto: true,
				worktreePath: session.worktreePath,
				agentId: session.agentId,
			})
			.match(
				(checkpoint) => {
					this.lastCheckpointEditCount.set(sessionId, modifiedFilesState.totalEditCount);
					logger.info("Auto-checkpoint created", {
						sessionId,
						checkpointId: checkpoint.id,
						checkpointNumber: checkpoint.checkpointNumber,
					});
				},
				(error) => {
					const errorDetails = getErrorCauseDetails(error);
					logger.error("Failed to create auto-checkpoint", {
						sessionId,
						error: errorDetails.formatted,
						errorChain: errorDetails.chain,
						rootCause: errorDetails.rootCause,
						projectPath: session.projectPath,
						filePaths: modifiedFilePaths,
					});
				}
			);
	}

	/**
	 * Handle stream error from Tauri events.
	 */
	handleStreamError(sessionId: string, error: Error): void {
		this.entryManager.clearStreamingAssistantEntry(sessionId);
		// Transition machine STREAMING → ERROR
		this.connectionManager.sendConnectionError(sessionId);
		this.hotStateManager.updateHotState(sessionId, {
			status: "error",
			turnState: "error",
			connectionError: error.message,
		});
		logger.error("Stream error", { sessionId, error });
	}

	/**
	 * Handle turn error from agent (e.g., usage limit reached).
	 * Uses explicit turn failure semantics from the backend.
	 */
	handleTurnError(sessionId: string, error: TurnErrorPayload): void {
		this.entryManager.clearStreamingAssistantEntry(sessionId);
		const normalized = normalizeTurnError(error);
		const errorEntry: SessionEntry = {
			id: crypto.randomUUID(),
			type: "error",
			message: {
				content: normalized.message,
				code: normalized.code != null ? String(normalized.code) : undefined,
			},
			timestamp: new Date(),
		};
		this.entryManager.addEntry(sessionId, errorEntry);

		this.connectionManager.sendTurnFailed(sessionId, {
			kind: normalized.kind,
			message: normalized.message,
		});

		if (normalized.kind === "fatal") {
			this.hotStateManager.updateHotState(sessionId, {
				status: "error",
				turnState: "error",
				connectionError: null,
			});
			logger.error("Fatal turn error", {
				sessionId,
				error: normalized.message,
				code: normalized.code ?? undefined,
				source: normalized.source ?? undefined,
			});
		} else {
			this.hotStateManager.updateHotState(sessionId, {
				status: "ready",
				turnState: "error",
				connectionError: null,
			});
			logger.error("Recoverable turn error", {
				sessionId,
				error: normalized.message,
				code: normalized.code ?? undefined,
				source: normalized.source ?? undefined,
			});
		}
	}

	// ============================================
	// TOOL CALLS
	// ============================================

	/**
	 * Create a new tool call entry from full ToolCallData.
	 */
	createToolCallEntry(sessionId: string, toolCallData: ToolCallData): void {
		this.entryManager.createToolCallEntry(sessionId, toolCallData);
	}

	/**
	 * Update tool call entry.
	 */
	updateToolCallEntry(sessionId: string, update: ToolCallUpdate): void {
		this.entryManager.updateToolCallEntry(sessionId, update);
	}

	/**
	 * Update a child tool call within its parent's taskChildren array.
	 * Uses O(1) child-to-parent index for fast lookup.
	 */
	updateChildInParent(sessionId: string, childUpdate: ToolCallUpdate): void {
		this.entryManager.updateChildInParent(sessionId, childUpdate);
	}

	/**
	 * Update available commands.
	 */
	updateAvailableCommands(sessionId: string, commands: AvailableCommand[]): void {
		this.hotStateManager.updateHotState(sessionId, {
			availableCommands: commands,
		});
	}

	/**
	 * Ensure streaming state is set.
	 */
	ensureStreamingState(sessionId: string): void {
		const hotState = this.hotStateManager.getHotState(sessionId);
		const machineState = this.connectionManager.getState(sessionId);

		// Transition connection state from awaitingResponse to streaming
		// This hides the "Thinking_" indicator when response starts
		if (machineState?.connection === ConnectionState.AWAITING_RESPONSE) {
			this.connectionManager.sendResponseStarted(sessionId);
			this.hotStateManager.updateHotState(sessionId, {
				status: "streaming",
				turnState: "streaming",
			});
			return;
		}

		if (hotState.turnState !== "streaming") {
			this.hotStateManager.updateHotState(sessionId, {
				status: "streaming",
				turnState: "streaming",
			});
		}
	}

	// ============================================
	// CHUNK AGGREGATION
	// ============================================

	/**
	 * Aggregate assistant chunk.
	 */
	aggregateAssistantChunk(
		sessionId: string,
		chunk: { content: ContentBlock },
		messageId: string | undefined,
		isThought: boolean
	): ResultAsync<void, AppError> {
		return this.entryManager.aggregateAssistantChunk(sessionId, chunk, messageId, isThought);
	}

	// ============================================
	// SESSION LIFECYCLE
	// ============================================

	/**
	 * Clear session-specific state when a session is disconnected or removed.
	 * Prevents memory leaks from accumulated tracking data.
	 */
	clearSessionState(sessionId: string): void {
		this.lastCheckpointEditCount.delete(sessionId);
	}
}

/**
 * Parse a data URL into raw base64 data and MIME type.
 * Input:  "data:image/png;base64,iVBORw0KGgo..."
 * Output: { data: "iVBORw0KGgo...", mimeType: "image/png" }
 */
function parseDataUrl(dataUrl: string): { data: string; mimeType: string } | null {
	const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
	if (!match || !match[1] || !match[2]) return null;
	if (!match[1].startsWith("image/")) return null;
	return { mimeType: match[1], data: match[2] };
}
