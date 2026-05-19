/**
 * Session Messaging Service - Handles message sending and canonical turn side effects.
 *
 * Responsibilities:
 * - Message sending with local pending-send affordances
 * - Canonical terminal-turn side effects
 *
 * This service is extracted from SessionStore to separate concerns
 * and reduce the God class anti-pattern.
 */

import { errAsync, type ResultAsync } from "neverthrow";
import type { ContentBlock } from "../../../services/converted-session-types.js";
import { isInlineImageAttachment } from "../../components/agent-input/logic/image-attachment.js";
import type { Attachment } from "../../components/agent-input/types/attachment.js";
import type { AppError } from "../../errors/app-error.js";
import { AgentError, ConnectionError, SessionNotFoundError } from "../../errors/app-error.js";
import { getErrorCauseDetails } from "../../errors/error-cause-details.js";
import { aggregateFileEditsFromToolCalls } from "../../logic/aggregate-file-edits.js";
import type { AvailableCommand } from "../../types/available-command.js";
import type { TurnCompleteUpdate, TurnErrorUpdate } from "../../types/turn-error.js";
import { normalizeActiveTurnFailure } from "../../types/turn-error.js";
import { createLogger } from "../../utils/logger.js";
import { api } from "../api.js";
import { checkpointStore } from "../checkpoint-store.svelte.js";
import { serializeWithAttachments } from "../message-queue/message-queue-store.svelte.js";
import type { SessionEntry } from "../types.js";
import { canActivateCreatedSessionWithFirstPrompt } from "./first-send-activation.js";
import type {
	IConnectionManager,
	IEntryManager,
	ISessionStateReader,
	ITransientProjectionManager,
} from "./interfaces/index.js";

const logger = createLogger({ id: "session-messaging-service", name: "SessionMessagingService" });
const PENDING_SEND_INTENT_TIMEOUT_MS = 90_000;

type UnrefableTimeout = ReturnType<typeof setTimeout> & {
	readonly unref?: () => void;
};

type PromptContentBlocks = {
	readonly textContent: string;
	readonly imageBlocks: ReadonlyArray<Extract<ContentBlock, { type: "image" }>>;
	readonly contentBlocks: ReadonlyArray<{
		type: string;
		text?: string;
		data?: string;
		mimeType?: string;
	}>;
};

function buildOptimisticUserEntry(
	textContent: string,
	imageBlocks: ReadonlyArray<Extract<ContentBlock, { type: "image" }>>,
	createdAt: Date
): SessionEntry {
	const textBlock = { type: "text" as const, text: textContent };
	const chunks: ContentBlock[] = [];
	for (const imageBlock of imageBlocks) {
		chunks.push(imageBlock);
	}
	if (textContent.length > 0) {
		chunks.push(textBlock);
	}

	return {
		id: crypto.randomUUID(),
		type: "user",
		message: {
			content: textContent.length > 0 ? textBlock : (imageBlocks[0] ?? textBlock),
			chunks,
			sentAt: createdAt,
		},
		timestamp: createdAt,
	};
}

function matchesTurnId(
	previousTurnId: string | null | undefined,
	nextTurnId: string | null | undefined
): boolean {
	if (previousTurnId == null || nextTurnId == null) {
		return previousTurnId == null && nextTurnId == null;
	}

	return previousTurnId === nextTurnId;
}

function buildPromptContentBlocks(
	content: string,
	attachments: readonly Attachment[]
): PromptContentBlocks | null {
	const imageAttachments = attachments.filter(isInlineImageAttachment);
	const otherAttachments = attachments.filter((attachment) => !isInlineImageAttachment(attachment));
	const textContent = serializeWithAttachments(content, otherAttachments).trim();
	const imageBlocks: Array<Extract<ContentBlock, { type: "image" }>> = [];
	for (const imageAttachment of imageAttachments) {
		if (!imageAttachment.content) {
			continue;
		}
		const parsed = parseDataUrl(imageAttachment.content);
		if (parsed === null) {
			continue;
		}
		imageBlocks.push({ type: "image", data: parsed.data, mimeType: parsed.mimeType });
	}
	if (!textContent && imageBlocks.length === 0) {
		return null;
	}

	const contentBlocks: Array<{ type: string; text?: string; data?: string; mimeType?: string }> =
		[];
	for (const imageBlock of imageBlocks) {
		contentBlocks.push({
			type: imageBlock.type,
			data: imageBlock.data,
			mimeType: imageBlock.mimeType,
		});
	}
	if (textContent) {
		contentBlocks.push({ type: "text", text: textContent });
	}

	return {
		textContent,
		imageBlocks,
		contentBlocks,
	};
}

/**
 * Service for messaging and streaming operations.
 */
export class SessionMessagingService {
	/**
	 * Tracks the total edit count at last checkpoint per session.
	 * Used to avoid creating duplicate checkpoints when no new edits occurred.
	 */
	private lastCheckpointEditCount = new Map<string, number>();
	private pendingSendAttemptIds = new Map<string, string>();
	private pendingSendIntentTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(
		private readonly stateReader: ISessionStateReader,
		private readonly transientProjectionManager: ITransientProjectionManager,
		private readonly entryManager: IEntryManager,
		private readonly connectionManager: IConnectionManager
	) {}

	private setPendingSendIntent(
		sessionId: string,
		attemptId: string,
		promptLength: number,
		optimisticEntry: SessionEntry
	): void {
		const previousTimeout = this.pendingSendIntentTimeouts.get(sessionId);
		if (previousTimeout !== undefined) {
			clearTimeout(previousTimeout);
		}

		this.pendingSendAttemptIds.set(sessionId, attemptId);
		this.transientProjectionManager.updateTransientProjection(sessionId, {
			pendingSendIntent: {
				attemptId,
				startedAt: Date.now(),
				baselineTranscriptRevision:
					this.stateReader.getGraphTranscriptRevision(sessionId) ?? null,
				promptLength,
				optimisticEntry,
			},
		});

		const timeoutId = setTimeout(() => {
			this.clearPendingSendIntent(sessionId, attemptId);
		}, PENDING_SEND_INTENT_TIMEOUT_MS);
		(timeoutId as UnrefableTimeout).unref?.();
		this.pendingSendIntentTimeouts.set(sessionId, timeoutId);
	}

	private clearPendingSendIntent(sessionId: string, attemptId: string): void {
		if (this.pendingSendAttemptIds.get(sessionId) !== attemptId) {
			return;
		}

		this.pendingSendAttemptIds.delete(sessionId);
		const timeoutId = this.pendingSendIntentTimeouts.get(sessionId);
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
			this.pendingSendIntentTimeouts.delete(sessionId);
		}

		this.transientProjectionManager.updateTransientProjection(sessionId, {
			pendingSendIntent: null,
		});
	}

	private recordTerminalTurnForSession(sessionId: string): void {
		this.pendingSendAttemptIds.delete(sessionId);
		const timeoutId = this.pendingSendIntentTimeouts.get(sessionId);
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
			this.pendingSendIntentTimeouts.delete(sessionId);
		}

		this.transientProjectionManager.updateTransientProjection(sessionId, {
			pendingSendIntent: null,
		});
	}

	// ============================================
	// MESSAGING
	// ============================================

	/**
	 * Send a message to a session.
	 *
	 * Note: This is fire-and-forget. The prompt is sent immediately but the response
	 * arrives via canonical session-state envelopes.
	 * Stream completion is NOT triggered here; it happens when Rust emits a
	 * terminal turn state.
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
		const lifecycleStatus = this.stateReader.getSessionLifecycleStatus(sessionId);
		const canonicalCanSend = this.stateReader.getSessionCanSend(sessionId);
		const canActivateFirstPrompt = canActivateCreatedSessionWithFirstPrompt({
			session,
			lifecycleStatus,
		});
		const canSend = canonicalCanSend === true;
		if (!canSend && !canActivateFirstPrompt) {
			return errAsync(new ConnectionError(sessionId));
		}

		const promptContent = buildPromptContentBlocks(content, attachments);
		if (promptContent === null) {
			logger.warn("Attempted to send empty message, ignoring", { sessionId });
			return errAsync(new AgentError("sendMessage: cannot send empty message"));
		}

		const textContent = promptContent.textContent;
		const imageBlocks = promptContent.imageBlocks;
		const sendAttemptId = crypto.randomUUID();
		const optimisticEntry = buildOptimisticUserEntry(textContent, imageBlocks, new Date());
		this.setPendingSendIntent(sessionId, sendAttemptId, textContent.length, optimisticEntry);

		// Start awaiting response in state machine
		this.connectionManager.sendMessageSent(sessionId);

		logger.debug("Sending message (optimistic)", { sessionId });

		return api
			.sendPrompt(sessionId, promptContent.contentBlocks, sendAttemptId)
			.map(() => {
				// Prompt sent successfully - response will arrive via Tauri events
				// DO NOT call stream complete here - sendPrompt is fire-and-forget
				logger.debug("Message sent successfully", { sessionId });
			})
			.mapErr((error) => {
				// Transition XState machine to ERROR (fatal) — subprocess is dead and
				// cannot accept messages. Canonical envelopes remain lifecycle authority.
				this.connectionManager.sendTurnFailed(sessionId, {
					turnId: null,
					kind: "fatal",
					message: error.message,
					code: null,
					source: "unknown",
				});
				this.clearPendingSendIntent(sessionId, sendAttemptId);
				logger.error("Failed to send message, rolling back", {
					sessionId,
					error,
				});
				return error;
			});
	}

	sendPendingCreationMessage(
		sessionId: string,
		content: string,
		attachments: readonly Attachment[] = []
	): ResultAsync<void, AppError> {
		const promptContent = buildPromptContentBlocks(content, attachments);
		if (promptContent === null) {
			logger.warn("Attempted to send empty pending creation message", { sessionId });
			return errAsync(new AgentError("sendPendingCreationMessage: cannot send empty message"));
		}

		const sendAttemptId = crypto.randomUUID();
		const optimisticEntry = buildOptimisticUserEntry(
			promptContent.textContent,
			promptContent.imageBlocks,
			new Date()
		);
		this.setPendingSendIntent(
			sessionId,
			sendAttemptId,
			promptContent.textContent.length,
			optimisticEntry
		);
		this.connectionManager.sendMessageSent(sessionId);
		return api
			.sendPrompt(sessionId, promptContent.contentBlocks, sendAttemptId)
			.map(() => {
				logger.debug("Pending creation prompt sent successfully", { sessionId });
			})
			.mapErr((error) => {
				this.connectionManager.sendTurnFailed(sessionId, {
					turnId: null,
					kind: "fatal",
					message: error.message,
					code: null,
					source: "unknown",
				});
				this.clearPendingSendIntent(sessionId, sendAttemptId);
				logger.error("Failed to send pending creation message", {
					sessionId,
					error,
				});
				return error;
			});
	}

	/**
	 * Handle canonical turn completion side effects.
	 */
	handleCanonicalTurnComplete(sessionId: string, turnId?: TurnCompleteUpdate["turn_id"]): void {
		const turnState = this.stateReader.getSessionTurnState(sessionId);
		const lastTerminalTurnId = this.stateReader.getSessionLastTerminalTurnId(sessionId);
		this.recordTerminalTurnForSession(sessionId);
		if (turnState === "Completed") {
			if (this.connectionManager.isResponseInProgress(sessionId)) {
				this.connectionManager.sendResponseComplete(sessionId);
				this.entryManager.finalizeStreamingEntries(sessionId);
			}
			return;
		}

		if (turnState === "Failed" && matchesTurnId(lastTerminalTurnId, turnId ?? null)) {
			// Still finalize streaming entries — tool calls may have been streaming when
			// the error occurred and need to stop shimmering.
			this.entryManager.finalizeStreamingEntries(sessionId);
			return;
		}

		// Intentionally do NOT clear assistant chunk aggregation state here.
		// Some providers can emit trailing assistant chunks after turnComplete,
		// and those chunks may omit message_id. Keeping the last known tracker
		// prevents fragmented one-word assistant entries.
		// Complete streaming in state machine
		this.connectionManager.sendResponseComplete(sessionId);

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

		const toolCalls = this.stateReader.getSessionToolCalls(sessionId);
		const modifiedFilesState = aggregateFileEditsFromToolCalls(toolCalls);
		if (modifiedFilesState.fileCount === 0) {
			logger.info("Auto-checkpoint skipped: no edit entries found", {
				sessionId,
				toolCallEntries: toolCalls.length,
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
	 * Handle canonical turn failure side effects from the backend.
	 */
	handleCanonicalTurnFailure(sessionId: string, update: TurnErrorUpdate): void {
		const turnState = this.stateReader.getSessionTurnState(sessionId);
		const lastTerminalTurnId = this.stateReader.getSessionLastTerminalTurnId(sessionId);
		const normalized = normalizeActiveTurnFailure(update);

		if (turnState === "Failed" && matchesTurnId(lastTerminalTurnId, normalized.turnId)) {
			logger.warn("Ignoring duplicate turn error for terminal turn", {
				sessionId,
				turnId: normalized.turnId,
			});
			return;
		}

		this.connectionManager.sendTurnFailed(sessionId, normalized);

		if (normalized.kind === "fatal") {
			logger.error("Fatal turn error", {
				sessionId,
				error: normalized.message,
				code: normalized.code ?? undefined,
				source: normalized.source,
				turnId: normalized.turnId,
			});
		} else {
			logger.error("Recoverable turn error", {
				sessionId,
				error: normalized.message,
				code: normalized.code ?? undefined,
				source: normalized.source,
				turnId: normalized.turnId,
			});
		}
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
		this.pendingSendAttemptIds.delete(sessionId);
		const timeoutId = this.pendingSendIntentTimeouts.get(sessionId);
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
			this.pendingSendIntentTimeouts.delete(sessionId);
		}
		if (this.transientProjectionManager.hasTransientProjection(sessionId)) {
			this.transientProjectionManager.updateTransientProjection(sessionId, {
				pendingSendIntent: null,
			});
		}
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
