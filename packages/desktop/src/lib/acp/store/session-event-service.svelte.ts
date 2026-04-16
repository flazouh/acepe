/**
 * Session Event Service - Manages event handling and buffering.
 *
 * Handles:
 * - Event subscription lifecycle
 * - Pending event buffering for race conditions
 * - Session update processing
 * - Permission and question request handling
 */

import { okAsync, type ResultAsync } from "neverthrow";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

import type {
	AvailableCommand,
	ConfigOptionData,
	JsonValue,
	PlanData,
	SessionUpdate,
	ToolCallData,
	ToolCallUpdateData,
	UsageTelemetryData,
} from "../../services/converted-session-types.js";
import type { SessionModelState } from "../../services/acp-types.js";
import type { AppError } from "../errors/app-error.js";
import { AgentError } from "../errors/app-error.js";
import { EventSubscriber } from "../logic/event-subscriber";
import { createPermissionRequest, type PermissionRequest } from "../types/permission";
import type { QuestionRequest } from "../types/question";
import {
	createLegacyInteractionReplyHandler,
	normalizeInteractionReplyHandler,
} from "../types/reply-handler.js";
import { createLogger } from "../utils/logger.js";
import { rawStreamingStore } from "./raw-streaming-store.svelte.js";
import { enrichExistingToolCallFromPermission } from "./services/permission-tool-call-enricher.js";
import type { SessionEventHandler } from "./session-event-handler.js";
import type { SessionContextBudget, SessionUsageTelemetry } from "./types.js";

const logger = createLogger({ id: "session-event-service", name: "SessionEventService" });

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getUsageTelemetryData(update: SessionUpdate): UsageTelemetryData | null {
	if (update.type !== "usageTelemetryUpdate") {
		return null;
	}

	const rawData = (update as { data?: JsonValue }).data;
	if (!isJsonObject(rawData)) {
		return null;
	}
	const rawSessionId = rawData.sessionId;
	if (typeof rawSessionId !== "string" || rawSessionId.length === 0) {
		return null;
	}

	return update.data;
}

/**
 * Extract session_id from SessionUpdate.
 *
 * With internally tagged format, session_id is a top-level field,
 * except usageTelemetryUpdate where it is in data.sessionId.
 */
function getSessionId(update: SessionUpdate): string | null | undefined {
	if (update.type === "usageTelemetryUpdate") {
		return getUsageTelemetryData(update)?.sessionId;
	}
	return (update as { session_id?: string | null }).session_id;
}

function getAssistantAggregationKey(
	update: Extract<SessionUpdate, { type: "agentMessageChunk" | "agentThoughtChunk" }>
): string | undefined {
	return update.message_id ?? undefined;
}

function isPendingToolCallStatus(status: string | null | undefined): boolean {
	return status === "pending" || status === "in_progress";
}

function isTerminalToolCallStatus(status: string | null | undefined): boolean {
	return status === "completed" || status === "failed";
}

function isContentBearingToolCallUpdate(
	update: ToolCallUpdateData
): boolean {
	return (
		update.result !== null ||
		update.result !== undefined ||
		update.rawOutput !== null ||
		update.rawOutput !== undefined ||
		update.content !== null ||
		update.content !== undefined ||
		update.locations !== null ||
		update.locations !== undefined
	);
}

function hasToolCallEntry(
	handler: SessionEventHandler,
	sessionId: string,
	toolCallId: string
): boolean {
	return handler
		.getEntries(sessionId)
		.some((entry) => entry.type === "tool_call" && entry.message.id === toolCallId);
}

function hashReplayFingerprint(input: string): string {
	let hash = 2166136261;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${input.length}:${(hash >>> 0).toString(16)}`;
}

function serializeToolCallReplayPayload(toolCall: ToolCallData): string {
	const title = toolCall.title ?? "";
	const kind = toolCall.kind ?? "none";
	const rawInputFingerprint = JSON.stringify(toolCall.rawInput ?? null);
	const argumentsFingerprint = JSON.stringify(toolCall.arguments);
	const resultFingerprint = JSON.stringify(toolCall.result ?? null);
	const locationsFingerprint = JSON.stringify(toolCall.locations ?? null);
	const skillMetaFingerprint = JSON.stringify(toolCall.skillMeta ?? null);
	const normalizedQuestionsFingerprint = JSON.stringify(toolCall.normalizedQuestions ?? null);
	const normalizedTodosFingerprint = JSON.stringify(toolCall.normalizedTodos ?? null);
	const parentToolUseId = toolCall.parentToolUseId ?? "none";
	const questionAnswerFingerprint = JSON.stringify(toolCall.questionAnswer ?? null);
	const awaitingPlanApproval = toolCall.awaitingPlanApproval ? "1" : "0";
	const planApprovalRequestId = toolCall.planApprovalRequestId ?? "none";
	const taskChildrenFingerprint = createTaskChildrenFingerprint(toolCall.taskChildren);
	return `${toolCall.id}:${toolCall.name}:${kind}:${toolCall.status}:${title}:${rawInputFingerprint}:${argumentsFingerprint}:${resultFingerprint}:${locationsFingerprint}:${skillMetaFingerprint}:${normalizedQuestionsFingerprint}:${normalizedTodosFingerprint}:${parentToolUseId}:${questionAnswerFingerprint}:${awaitingPlanApproval}:${planApprovalRequestId}:${taskChildrenFingerprint}`;
}

function serializeTaskChildrenFingerprint(
	taskChildren: ReadonlyArray<ToolCallData> | null | undefined
): string {
	if (!taskChildren || taskChildren.length === 0) {
		return "none";
	}

	return taskChildren.map((child) => serializeToolCallReplayPayload(child)).join(",");
}

function createTaskChildrenFingerprint(
	taskChildren: ReadonlyArray<ToolCallData> | null | undefined
): string {
	if (!taskChildren || taskChildren.length === 0) {
		return "none";
	}

	return hashReplayFingerprint(serializeTaskChildrenFingerprint(taskChildren));
}

function serializeToolCallUpdateReplayPayload(update: ToolCallUpdateData): string {
	const status = update.status ?? "none";
	const title = update.title ?? "";
	const resultFingerprint = JSON.stringify(update.result ?? null);
	const contentFingerprint = JSON.stringify(update.content ?? null);
	const rawOutputFingerprint = JSON.stringify(update.rawOutput ?? null);
	const locationsFingerprint = JSON.stringify(update.locations ?? null);
	const streamingInputDelta = update.streamingInputDelta ?? "";
	const normalizedTodosFingerprint = JSON.stringify(update.normalizedTodos ?? null);
	const normalizedQuestionsFingerprint = JSON.stringify(update.normalizedQuestions ?? null);
	const streamingArgumentsFingerprint = JSON.stringify(update.streamingArguments ?? null);
	const argumentsFingerprint = JSON.stringify(update.arguments ?? null);
	const failureReason = update.failureReason ?? "";
	return `${update.toolCallId}:${status}:${title}:${resultFingerprint}:${contentFingerprint}:${rawOutputFingerprint}:${locationsFingerprint}:${streamingInputDelta}:${normalizedTodosFingerprint}:${normalizedQuestionsFingerprint}:${streamingArgumentsFingerprint}:${argumentsFingerprint}:${failureReason}`;
}

function isProcessedToolReplay(
	handler: SessionEventHandler,
	sessionId: string,
	update: SessionUpdate,
	replayCount: number
): boolean {
	if (replayCount <= 1) {
		return false;
	}

	switch (update.type) {
		case "toolCall":
			return hasToolCallEntry(handler, sessionId, update.tool_call.id);
		case "toolCallUpdate":
			return hasToolCallEntry(handler, sessionId, update.update.toolCallId);
		default:
			return false;
	}
}

function resolveContextBudget(
	usageTelemetryData: UsageTelemetryData,
	previous: SessionUsageTelemetry | undefined,
	_currentModelId: string | null,
	updatedAt: number
): SessionContextBudget | null {
	const explicitMaxTokens = usageTelemetryData.contextWindowSize ?? null;
	if (explicitMaxTokens != null && explicitMaxTokens > 0) {
		return {
			maxTokens: explicitMaxTokens,
			source: "provider-explicit",
			scope: usageTelemetryData.scope ?? "step",
			updatedAt,
		};
	}

	if (previous?.contextBudget?.source === "provider-explicit") {
		return previous.contextBudget;
	}

	return previous?.contextBudget ?? null;
}

function toPermissionToolReference(
	tool: { messageId: string; callId: string } | null | undefined
): { messageID: string; callID: string } | undefined {
	if (!tool) {
		return undefined;
	}
	return {
		messageID: tool.messageId,
		callID: tool.callId,
	};
}

/** Data payload delivered with a connectionComplete lifecycle event. */
export interface ConnectionCompleteData {
	models: SessionModelState;
	modes: { currentModeId?: string; availableModes?: Array<{ id: string; name: string; description?: string | null }> };
	availableCommands: AvailableCommand[];
	configOptions: ConfigOptionData[];
	autonomousEnabled: boolean;
}

export interface SessionEventServiceCallbacks {
	onPermissionRequest?: (permission: PermissionRequest) => void;
	onQuestionRequest?: (question: QuestionRequest) => void;
	onPlanUpdate?: (sessionId: string, planData: PlanData) => void;
	onTurnComplete?: (sessionId: string) => void;
}

/** Internal entry for a pending lifecycle waiter. */
interface LifecycleWaiter {
	attemptId: number;
	resolve: (data: ConnectionCompleteData) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
}

function shouldBypassDisconnectedBuffer(update: SessionUpdate): boolean {
	return (
		update.type === "permissionRequest" ||
		update.type === "questionRequest" ||
		update.type === "connectionComplete" ||
		update.type === "connectionFailed"
	);
}

export class SessionEventService {
	// Event subscriber for session updates
	private eventSubscriber: EventSubscriber | null = null;
	private eventSubscriptionId: string | null = null;
	private replaySuppressedSessionIds = new SvelteSet<string>();

	// Pending events buffer for sessions being created (race condition handling)
	private pendingEvents = new SvelteMap<string, SessionUpdate[]>();
	private pendingEventTimestamps = new SvelteMap<string, number>();
	private static readonly PENDING_EVENT_TIMEOUT_MS = 10000; // 10 seconds
	private static readonly MAX_PENDING_EVENTS_PER_SESSION = 100; // Prevent unbounded growth
	private static readonly PENDING_FLUSH_CHUNK_SIZE = 25;
	private static readonly TELEMETRY_REPORT_INTERVAL_MS = 5000;
	private static readonly TELEMETRY_WARN_COOLDOWN_MS = 5000;
	private static readonly WARN_EVENTS_PER_SECOND = 200;
	private static readonly WARN_REPLAY_CHUNK_DURATION_MS = 8;
	private static readonly WARN_PENDING_BACKLOG_SIZE = 100;
	private pendingFlushTimeouts = new SvelteMap<string, ReturnType<typeof setTimeout>>();
	private telemetryIntervalId: ReturnType<typeof setInterval> | null = null;
	private telemetryWindowStartMs = Date.now();
	private telemetryEventCount = 0;
	private telemetryDisconnectedDrops = 0;
	private telemetryMaxPendingBacklog = 0;
	private telemetryMaxReplayChunkDurationMs = 0;
	private telemetryMaxReplayChunkSize = 0;
	private telemetryLastWarnAt = new SvelteMap<
		"events" | "chunk" | "backlog" | "disconnected",
		number
	>();
	private replayFingerprintState = new SvelteMap<
		string,
		{
			firstSeenMs: number;
			lastSeenMs: number;
			count: number;
		}
	>();
	private static readonly REPLAY_FINGERPRINT_TTL_MS = 15 * 60 * 1000;
	private static readonly REPLAY_CHUNK_DUPLICATE_WINDOW_MS = 3000;

	// Callbacks for permission/question handling
	private callbacks: SessionEventServiceCallbacks = {};

	// Lifecycle waiters — per-session promises awaiting connectionComplete/connectionFailed
	private lifecycleWaiters = new Map<string, LifecycleWaiter>();

	/**
	 * Set callbacks for handling permission and question requests.
	 */
	setCallbacks(callbacks: SessionEventServiceCallbacks): void {
		this.callbacks = callbacks;
	}

	/**
	 * Subscribe to the lifecycle outcome for a single connect attempt.
	 * Returns a promise that resolves on connectionComplete, rejects on
	 * connectionFailed or timeout. Subscription is automatically cleaned
	 * up on resolution — call `cancel()` to clean up early (e.g. if the
	 * invoke itself fails before Rust can emit an event).
	 *
	 * MUST be called BEFORE firing the Tauri invoke so the listener is
	 * in place before the SSE event can possibly arrive.
	 */
	waitForLifecycleEvent(
		sessionId: string,
		attemptId: number,
		timeoutMs: number
	): { promise: Promise<ConnectionCompleteData>; cancel: () => void } {
		// Cancel any stale waiter for the same session (defensive)
		this.cancelLifecycleWaiter(sessionId);

		let waiterResolve!: (data: ConnectionCompleteData) => void;
		let waiterReject!: (error: Error) => void;
		const promise = new Promise<ConnectionCompleteData>((resolve, reject) => {
			waiterResolve = resolve;
			waiterReject = reject;
		});

		const timeoutId = setTimeout(() => {
			const waiter = this.takeLifecycleWaiter(sessionId, attemptId);
			if (!waiter) {
				return;
			}
			waiter.reject(
				new Error(`Watchdog timeout: no response from Rust within ${timeoutMs / 1000}s`)
			);
		}, timeoutMs);

		this.lifecycleWaiters.set(sessionId, {
			attemptId,
			resolve: waiterResolve,
			reject: waiterReject,
			timeoutId,
		});

		const cancel = () => {
			this.cancelLifecycleWaiter(sessionId, attemptId);
		};

		return { promise, cancel };
	}

	/**
	 * Cancel a pending lifecycle waiter without resolving or rejecting.
	 */
	cancelLifecycleWaiter(sessionId: string, attemptId?: number): void {
		const waiter = this.lifecycleWaiters.get(sessionId);
		if (waiter) {
			if (attemptId !== undefined && waiter.attemptId !== attemptId) {
				return;
			}
			clearTimeout(waiter.timeoutId);
			this.lifecycleWaiters.delete(sessionId);
		}
	}

	private takeLifecycleWaiter(
		sessionId: string,
		attemptId: number
	): LifecycleWaiter | undefined {
		const waiter = this.lifecycleWaiters.get(sessionId);
		if (!waiter) {
			return undefined;
		}
		if (waiter.attemptId !== attemptId) {
			logger.debug("Ignoring stale lifecycle event", {
				sessionId,
				attemptId,
				expectedAttemptId: waiter.attemptId,
			});
			return undefined;
		}
		clearTimeout(waiter.timeoutId);
		this.lifecycleWaiters.delete(sessionId);
		return waiter;
	}

	/**
	 * Suppress replay-style content updates for a preloaded session.
	 * Used when connecting a historical session that already has full disk content.
	 */
	suppressReplayForSession(sessionId: string): void {
		this.replaySuppressedSessionIds.add(sessionId);
	}

	/**
	 * Clear replay suppression so all updates are processed normally.
	 */
	clearReplaySuppressionForSession(sessionId: string): void {
		this.replaySuppressedSessionIds.delete(sessionId);
	}

	/**
	 * Initialize session update subscription.
	 */
	initializeSessionUpdates(handler: SessionEventHandler): ResultAsync<void, AppError> {
		if (this.eventSubscriber && this.eventSubscriptionId) {
			return okAsync(undefined);
		}
		// Recover from a partial/failed initialization attempt.
		if (this.eventSubscriber && !this.eventSubscriptionId) {
			this.eventSubscriber = null;
		}

		const subscriber = new EventSubscriber();
		return subscriber
			.subscribe((update: SessionUpdate) => {
				this.handleSessionUpdate(update, handler);
			})
			.map((id) => {
				this.eventSubscriber = subscriber;
				this.eventSubscriptionId = id;
				this.startTelemetryReporter();
				logger.debug("Session update subscription initialized", { subscriptionId: id });
				return undefined;
			})
			.mapErr((error) => {
				this.eventSubscriber = null;
				this.eventSubscriptionId = null;
				logger.error("Failed to initialize session update subscription", { error });
				return new AgentError(
					"initializeSessionUpdates",
					error instanceof Error ? error : new Error(String(error))
				);
			});
	}

	/**
	 * Cleanup session update subscription.
	 */
	cleanupSessionUpdates(): void {
		for (const timeoutId of this.pendingFlushTimeouts.values()) {
			clearTimeout(timeoutId);
		}
		this.pendingFlushTimeouts.clear();
		this.replaySuppressedSessionIds.clear();
		this.replayFingerprintState.clear();
		this.stopTelemetryReporter();

		if (this.eventSubscriber && this.eventSubscriptionId) {
			this.eventSubscriber.unsubscribeById(this.eventSubscriptionId);
			this.eventSubscriber = null;
			this.eventSubscriptionId = null;
		}
	}

	/**
	 * Handle session update from EventSubscriber.
	 *
	 * Note: Streaming deltas and message chunks are already batched at 16ms intervals
	 * by the Rust StreamingDeltaBatcher before being emitted as Tauri events.
	 * We process them directly here without additional buffering.
	 */
	private _hangDebugUpdateCount = 0;
	private _hangDebugStartTime = performance.now();

	handleSessionUpdate(update: SessionUpdate, handler: SessionEventHandler): void {
		this._hangDebugUpdateCount++;
		const now = performance.now();
		if (now - this._hangDebugStartTime > 5000) {
			this._hangDebugUpdateCount = 0;
			this._hangDebugStartTime = now;
		}
		const sessionId = getSessionId(update);
		if (!sessionId) {
			logger.warn("Session update missing sessionId", { update });
			return;
		}

		const session = handler.getSessionCold(sessionId);

		// Check hot state for connection status — cold state never includes
		// isConnected/status fields, so we always read from the hot state store.
		const hotState = session ? handler.getHotState(sessionId) : null;
		const isDisconnectedSession = hotState?.isConnected === false;
		const isConnectingSession = hotState?.status === "connecting";
		const replayStats = this.recordReplayFingerprint(sessionId, update, hotState?.turnState);
		if (this.shouldDropDuplicateUpdate(update, replayStats, hotState?.turnState)) {
			logger.warn("Dropping duplicate replayed session update", {
				sessionId,
				updateType: update.type,
				duplicateCount: replayStats.count,
				duplicateAgeMs: replayStats.sinceLastSeenMs,
				fingerprint: replayStats.fingerprint,
			});
			return;
		}
		if (isProcessedToolReplay(handler, sessionId, update, replayStats.count)) {
			logger.warn("Dropping duplicate tool replay for existing entry", {
				sessionId,
				updateType: update.type,
				duplicateCount: replayStats.count,
				fingerprint: replayStats.fingerprint,
			});
			return;
		}

		// If replay suppression is active for this session, drop historical content
		// while idle. During an active turn we allow updates to flow through, but we keep
		// suppression armed so any later idle-time replay bursts are still blocked.
		if (this.replaySuppressedSessionIds.has(sessionId)) {
			const hasActiveTurn = hotState?.turnState !== undefined && hotState.turnState !== "idle";
			const hasExistingToolEntryForReplay =
				update.type === "toolCall"
					? hasToolCallEntry(handler, sessionId, update.tool_call.id)
					: update.type === "toolCallUpdate"
						? hasToolCallEntry(handler, sessionId, update.update.toolCallId)
						: false;
			if (
				!hasActiveTurn &&
				update.type === "toolCall" &&
				isPendingToolCallStatus(update.tool_call.status) &&
				hasExistingToolEntryForReplay
			) {
				logger.debug("Dropping replayed pending tool call already present in session", {
					sessionId,
					toolCallId: update.tool_call.id,
				});
				return;
			}
			if (
				!hasActiveTurn &&
				update.type === "toolCall" &&
				!hasExistingToolEntryForReplay &&
				isTerminalToolCallStatus(update.tool_call.status)
			) {
				logger.debug("Dropping replayed terminal tool call missing a canonical entry", {
					sessionId,
					toolCallId: update.tool_call.id,
				});
				return;
			}
			if (
				!hasActiveTurn &&
				update.type === "toolCallUpdate" &&
				!hasExistingToolEntryForReplay &&
				(isTerminalToolCallStatus(update.update.status) ||
					isContentBearingToolCallUpdate(update.update))
			) {
				logger.debug("Dropping replayed orphan tool call update while session is idle", {
					sessionId,
					toolCallId: update.update.toolCallId,
					status: update.update.status ?? "unknown",
				});
				return;
			}
			if (!hasActiveTurn && this.isReplaySuppressedUpdate(update)) {
				logger.debug("Dropping replay update for preloaded session", {
					sessionId,
					updateType: update.type,
				});
				return;
			}
		}

		// Buffer events for known disconnected sessions so they can be replayed
		// when connectSession() calls flushPendingEvents(). This handles the
		// startup race where ACP events arrive before session reconnection completes.
		if (isDisconnectedSession && !isConnectingSession && !shouldBypassDisconnectedBuffer(update)) {
			this.telemetryDisconnectedDrops++;
			this.warnWithCooldown("disconnected", "Buffered session update while disconnected", {
				sessionId,
				updateType: update.type,
				agentId: session?.agentId,
				status: hotState?.status,
			});
			this.bufferPendingEvent(sessionId, update);
			return;
		}

		this.recordInboundEvent();

		// Fast path for message/thought text chunks - process directly
		// Rust batcher already accumulates text at 16ms intervals
		if (update.type === "agentMessageChunk" || update.type === "agentThoughtChunk") {
			if (!this.hasKnownSession(handler, sessionId)) {
				this.bufferPendingEvent(sessionId, update);
				return;
			}
			const aggregationKey = getAssistantAggregationKey(update);

			if (update.chunk.content.type === "text") {
				handler
					.aggregateAssistantChunk(
						sessionId,
						update.chunk,
						aggregationKey,
						update.type === "agentThoughtChunk"
					)
					.mapErr((error) => logger.error("Failed to aggregate text chunk", { error }));
				handler.ensureStreamingState(sessionId);
				return;
			}
			// Non-text chunks fall through to normal processing
		}

		if (logger.isLevelEnabled("debug")) {
			logger.debug("Received session update", {
				type: update.type,
				sessionId,
			});
		}

		// Record raw event for debugging (dev mode only)
		rawStreamingStore.record(sessionId, update);

		if (update.type === "connectionComplete") {
			logger.info("Connection complete event received", {
				sessionId,
				attemptId: update.attempt_id,
				autonomousEnabled: update.autonomous_enabled,
			});
			this.takeLifecycleWaiter(sessionId, update.attempt_id)?.resolve({
				models: update.models,
				modes: update.modes,
				availableCommands: update.available_commands ?? [],
				configOptions: update.config_options ?? [],
				autonomousEnabled: update.autonomous_enabled,
			});
			return;
		}

		if (update.type === "connectionFailed") {
			logger.error("Connection failed event received", {
				sessionId,
				attemptId: update.attempt_id,
				error: update.error,
			});
			this.takeLifecycleWaiter(sessionId, update.attempt_id)?.reject(
				new Error(update.error)
			);
			return;
		}

		// Check if session exists in store.
		// Do NOT gate on preloaded/entries, because freshly resumed sessions can have zero entries.
		const hasSession = this.hasKnownSession(handler, sessionId);

		if (!hasSession) {
			this.bufferPendingEvent(sessionId, update);
			return;
		}

		switch (update.type) {
			case "agentMessageChunk": {
				const aggregationKey = getAssistantAggregationKey(update);
				// Text chunks are handled by fast path above, this handles non-text (e.g., tool_use)
				handler
					.aggregateAssistantChunk(sessionId, update.chunk, aggregationKey, false)
					.mapErr((error) => logger.error("Failed to aggregate message chunk", { error }));
				handler.ensureStreamingState(sessionId);
				break;
			}

			case "agentThoughtChunk": {
				const aggregationKey = getAssistantAggregationKey(update);
				// Text chunks are handled by fast path above, this handles non-text
				handler
					.aggregateAssistantChunk(sessionId, update.chunk, aggregationKey, true)
					.mapErr((error) => logger.error("Failed to aggregate thought chunk", { error }));
				handler.ensureStreamingState(sessionId);
				break;
			}

			case "toolCall":
				logger.debug("Creating tool call entry", {
					sessionId,
					toolCallId: update.tool_call.id,
					toolName: update.tool_call.name,
					toolKind: update.tool_call.kind,
				});
				handler.createToolCallEntry(sessionId, update.tool_call);
				handler.ensureStreamingState(sessionId);
				break;

			case "toolCallUpdate":
				// Streaming input deltas are handled by fast path above
				// Regular tool call update (status, result, etc.)
				// Apply canonical backend-owned tool updates directly; the frontend no longer
				// reconstructs child mutations from child-only deltas.
				logger.debug("Updating tool call entry (may be child)", {
					sessionId,
					toolCallId: update.update.toolCallId,
					status: update.update.status,
				});
				handler.updateToolCallEntry(sessionId, update.update);
				break;

			case "permissionRequest":
				// Permissions now converge here for session-update based agents, including
				// cc-sdk flows that still carry a JSON-RPC reply route.
				{
					const permission = createPermissionRequest({
						id: update.permission.id,
						sessionId: update.permission.sessionId,
						jsonRpcRequestId: update.permission.jsonRpcRequestId,
						replyHandler:
							normalizeInteractionReplyHandler(update.permission.replyHandler) ??
							createLegacyInteractionReplyHandler(
								update.permission.id,
								update.permission.jsonRpcRequestId
							),
						permission: update.permission.permission,
						patterns: update.permission.patterns,
						metadata: update.permission.metadata,
						always: update.permission.always,
						tool: update.permission.tool,
					});
					enrichExistingToolCallFromPermission(handler, permission);
					this.callbacks.onPermissionRequest?.(permission);
				}
				break;

			case "questionRequest":
				// Questions arrive as session updates across providers. Some still carry
				// a JSON-RPC request ID for the reply path.
				this.callbacks.onQuestionRequest?.({
					id: update.question.id,
					sessionId: update.question.sessionId,
					jsonRpcRequestId: update.question.jsonRpcRequestId ?? undefined,
					replyHandler:
						normalizeInteractionReplyHandler(update.question.replyHandler) ??
						createLegacyInteractionReplyHandler(
							update.question.id,
							update.question.jsonRpcRequestId
						),
					questions: update.question.questions,
					tool: toPermissionToolReference(update.question.tool),
				});
				break;

			case "availableCommandsUpdate":
				handler.updateAvailableCommands(sessionId, update.update.availableCommands);
				break;

			case "turnComplete":
				logger.info("Turn complete - calling handleStreamComplete", {
					sessionId,
					updateSessionId: update.session_id,
				});
				handler.handleStreamComplete(sessionId);
				this.callbacks.onTurnComplete?.(sessionId);
				break;

			case "turnError":
				logger.error("Turn error received", {
					sessionId,
					error: update.error,
				});
				handler.handleTurnError(sessionId, update.error);
				break;

			case "plan":
				this.callbacks.onPlanUpdate?.(sessionId, update.plan);
				if (
					this.shouldTreatPlanAsTurnComplete(update.plan, handler.getHotState(sessionId).turnState)
				) {
					handler.handleStreamComplete(sessionId);
				}
				break;

			case "userMessageChunk":
				// User chunks are turn boundaries for assistant aggregation.
				// Clear stale assistant message tracking so a subsequent assistant
				// chunk starts a new entry instead of appending to the previous turn.
				handler.clearStreamingAssistantEntry(sessionId);
				handler
					.aggregateUserChunk(sessionId, update.chunk)
					.mapErr((error) => logger.error("Failed to aggregate user chunk", { error }));
				break;

			case "currentModeUpdate":
				handler.updateCurrentMode(sessionId, update.update.currentModeId);
				break;

			case "configOptionUpdate": {
				// Store full config options state for UI rendering
				logger.debug("configOptionUpdate received", {
					sessionId,
					optionCount: update.update.configOptions.length,
					options: update.update.configOptions.map((o) => ({
						id: o.id,
						category: o.category,
						optionsCount: o.options?.length ?? 0,
						currentValue: o.currentValue,
					})),
				});
				handler.updateConfigOptions(sessionId, update.update.configOptions);

				// Backward compat: also sync mode if present
				const modeOption = update.update.configOptions.find((opt) => opt.category === "mode");
				if (modeOption && typeof modeOption.currentValue === "string") {
					handler.updateCurrentMode(sessionId, modeOption.currentValue);
				}
				break;
			}

			case "usageTelemetryUpdate": {
				const usageTelemetryData = getUsageTelemetryData(update);
				if (!usageTelemetryData) {
					logger.warn("Discarding malformed usage telemetry update", { update });
					break;
				}

				const current = handler.getHotState(sessionId);
				const prev = current.usageTelemetry;
				const eventId = usageTelemetryData.eventId ?? null;
				if (eventId !== null && prev?.lastTelemetryEventId === eventId) {
					break;
				}
				const costUsd = usageTelemetryData.costUsd ?? 0;
				const sessionSpendUsd = (prev?.sessionSpendUsd ?? 0) + costUsd;
				const t = usageTelemetryData.tokens;
				const updatedAt = Date.now();
				const currentModelId =
					current.currentModel != null && current.currentModel.id.length > 0
						? current.currentModel.id
						: null;
				handler.updateUsageTelemetry(sessionId, {
					sessionSpendUsd,
					latestStepCostUsd: usageTelemetryData.costUsd ?? null,
					latestTokensTotal: t?.total ?? null,
					latestTokensInput: t?.input ?? null,
					latestTokensOutput: t?.output ?? null,
					latestTokensCacheRead: t?.cacheRead ?? null,
					latestTokensCacheWrite: t?.cacheWrite ?? null,
					latestTokensReasoning: t?.reasoning ?? null,
					lastTelemetryEventId: eventId,
					contextBudget: resolveContextBudget(usageTelemetryData, prev, currentModelId, updatedAt),
					updatedAt,
				});
				break;
			}

			default: {
				update satisfies never;
			}
		}
	}

	private isReplaySuppressedUpdate(update: SessionUpdate): boolean {
		switch (update.type) {
			case "agentMessageChunk":
			case "agentThoughtChunk":
			case "userMessageChunk":
			case "plan":
			case "turnComplete":
			case "turnError":
			case "usageTelemetryUpdate":
				return true;
			default:
				return false;
		}
	}

	private shouldTreatPlanAsTurnComplete(
		plan: import("../../services/converted-session-types.js").PlanData,
		turnState: import("./types.js").TurnState
	): boolean {
		if (plan.streaming === true) {
			return false;
		}

		if (turnState !== "streaming") {
			return false;
		}

		return (
			plan.hasPlan === true ||
			typeof plan.contentMarkdown === "string" ||
			typeof plan.content === "string"
		);
	}

	private recordReplayFingerprint(
		sessionId: string,
		update: SessionUpdate,
		turnState: string | undefined
	): { count: number; fingerprint: string | null; sinceLastSeenMs: number | null } {
		const fingerprint = this.createReplayFingerprint(sessionId, update);
		if (!fingerprint) {
			return { count: 1, fingerprint: null, sinceLastSeenMs: null };
		}

		const now = this.nowMs();
		const cutoff = now - SessionEventService.REPLAY_FINGERPRINT_TTL_MS;
		for (const [key, value] of this.replayFingerprintState.entries()) {
			if (value.lastSeenMs < cutoff) {
				this.replayFingerprintState.delete(key);
			}
		}

		const existing = this.replayFingerprintState.get(fingerprint);
		if (!existing) {
			this.replayFingerprintState.set(fingerprint, {
				firstSeenMs: now,
				lastSeenMs: now,
				count: 1,
			});
			return { count: 1, fingerprint, sinceLastSeenMs: null };
		}

		const nextCount = existing.count + 1;
		const ageMs = Math.max(0, now - existing.firstSeenMs);
		const sinceLastSeenMs = Math.max(0, now - existing.lastSeenMs);
		this.replayFingerprintState.set(fingerprint, {
			firstSeenMs: existing.firstSeenMs,
			lastSeenMs: now,
			count: nextCount,
		});

		if (nextCount === 2 || nextCount === 5 || nextCount % 10 === 0) {
			logger.warn("Detected duplicate session update fingerprint", {
				sessionId,
				updateType: update.type,
				turnState: turnState ?? "unknown",
				duplicateCount: nextCount,
				ageMs,
				fingerprint,
			});
		}
		return { count: nextCount, fingerprint, sinceLastSeenMs };
	}

	private isLongTextChunk(update: SessionUpdate): boolean {
		if (
			update.type !== "agentMessageChunk" &&
			update.type !== "agentThoughtChunk" &&
			update.type !== "userMessageChunk"
		) {
			return false;
		}
		return update.chunk.content.type === "text" && update.chunk.content.text.trim().length >= 20;
	}

	private shouldDropDuplicateUpdate(
		update: SessionUpdate,
		replayStats: { count: number; sinceLastSeenMs: number | null },
		turnState: string | undefined
	): boolean {
		if (replayStats.count <= 1) {
			return false;
		}
		const isRapidDuplicate =
			replayStats.sinceLastSeenMs !== null &&
			replayStats.sinceLastSeenMs <= SessionEventService.REPLAY_CHUNK_DUPLICATE_WINDOW_MS;
		if (
			(update.type === "agentMessageChunk" ||
				update.type === "agentThoughtChunk" ||
				update.type === "userMessageChunk") &&
			this.isLongTextChunk(update)
		) {
			// Never drop during active streaming — the batcher guarantees unique deltas.
			// Dedup only applies during replay/reconnect (non-streaming turns).
			if (turnState === "streaming") {
				return false;
			}
			return isRapidDuplicate;
		}
		if (turnState !== undefined && turnState !== "idle") {
			return false;
		}

		switch (update.type) {
			case "availableCommandsUpdate":
			case "toolCall":
			case "toolCallUpdate":
				return true;
			default:
				return false;
		}
	}

	private createReplayFingerprint(sessionId: string, update: SessionUpdate): string | null {
		switch (update.type) {
			case "toolCall": {
				const payloadFingerprint = hashReplayFingerprint(
					serializeToolCallReplayPayload(update.tool_call)
				);
				return `${sessionId}|toolCall|${update.tool_call.id}|${payloadFingerprint}`;
			}
			case "toolCallUpdate": {
				const payloadFingerprint = hashReplayFingerprint(
					serializeToolCallUpdateReplayPayload(update.update)
				);
				return `${sessionId}|toolCallUpdate|${update.update.toolCallId}|${payloadFingerprint}`;
			}
			case "availableCommandsUpdate":
				return `${sessionId}|availableCommands|${update.update.availableCommands.length}`;
			case "userMessageChunk": {
				if (update.chunk.content.type !== "text") {
					return null;
				}
				const text = update.chunk.content.text.trim();
				if (text.length < 20) {
					return null;
				}
				return `${sessionId}|userMessageChunk|${text.slice(0, 120)}`;
			}
			case "agentMessageChunk":
			case "agentThoughtChunk": {
				if (update.chunk.content.type !== "text") {
					return null;
				}
				const text = update.chunk.content.text.trim();
				if (text.length < 20) {
					return null;
				}
				const messageId = update.message_id ?? "none";
				return `${sessionId}|${update.type}|${messageId}|${text.slice(0, 120)}`;
			}
			default:
				return null;
		}
	}

	/**
	 * Flush pending events for a session that was just created.
	 */
	flushPendingEvents(sessionId: string, handler: SessionEventHandler): void {
		const pending = this.pendingEvents.get(sessionId);
		if (!pending || pending.length === 0) {
			this.pendingEvents.delete(sessionId);
			this.pendingEventTimestamps.delete(sessionId);
			const timeoutId = this.pendingFlushTimeouts.get(sessionId);
			if (timeoutId) {
				clearTimeout(timeoutId);
				this.pendingFlushTimeouts.delete(sessionId);
			}
			return;
		}

		this.pendingEvents.delete(sessionId);
		this.pendingEventTimestamps.delete(sessionId);
		logger.debug("Flushing pending events", { sessionId, count: pending.length });
		this.flushPendingEventsChunked(sessionId, pending, handler, 0);
	}

	// ============================================
	// PRIVATE HELPERS
	// ============================================

	private flushPendingEventsChunked(
		sessionId: string,
		pending: SessionUpdate[],
		handler: SessionEventHandler,
		offset: number
	): void {
		const chunkStart = this.nowMs();
		const end = Math.min(offset + SessionEventService.PENDING_FLUSH_CHUNK_SIZE, pending.length);
		const chunkSize = end - offset;

		for (let i = offset; i < end; i++) {
			this.handleSessionUpdate(pending[i], handler);
		}
		const chunkDuration = this.nowMs() - chunkStart;
		this.telemetryMaxReplayChunkDurationMs = Math.max(
			this.telemetryMaxReplayChunkDurationMs,
			chunkDuration
		);
		this.telemetryMaxReplayChunkSize = Math.max(this.telemetryMaxReplayChunkSize, chunkSize);

		if (chunkDuration > SessionEventService.WARN_REPLAY_CHUNK_DURATION_MS) {
			this.warnWithCooldown("chunk", "Replay chunk exceeded frame budget", {
				sessionId,
				chunkDurationMs: Number(chunkDuration.toFixed(2)),
				chunkSize,
				remaining: pending.length - end,
			});
		}

		if (end >= pending.length) {
			this.pendingFlushTimeouts.delete(sessionId);
			return;
		}

		const timeoutId = setTimeout(() => {
			this.pendingFlushTimeouts.delete(sessionId);
			this.flushPendingEventsChunked(sessionId, pending, handler, end);
		}, 0);
		this.pendingFlushTimeouts.set(sessionId, timeoutId);
	}

	/**
	 * Schedule cleanup of orphaned pending events.
	 */
	private scheduleOrphanedEventCleanup(sessionId: string): void {
		setTimeout(() => {
			const timestamp = this.pendingEventTimestamps.get(sessionId);
			if (timestamp === undefined) {
				// Already cleaned up (session was created and events flushed)
				return;
			}

			const pending = this.pendingEvents.get(sessionId);
			const count = pending?.length ?? 0;
			this.pendingEvents.delete(sessionId);
			this.pendingEventTimestamps.delete(sessionId);
			logger.warn("Discarded orphaned pending events", {
				sessionId,
				count,
				elapsedMs: Date.now() - timestamp,
			});
		}, SessionEventService.PENDING_EVENT_TIMEOUT_MS + 100);
	}

	/**
	 * Check whether a session exists in the store.
	 */
	private hasKnownSession(handler: SessionEventHandler, sessionId: string): boolean {
		return handler.getSessionCold(sessionId) !== undefined;
	}

	/**
	 * Buffer event for session that may still be creating (race condition).
	 */
	private bufferPendingEvent(sessionId: string, update: SessionUpdate): void {
		const pending = this.pendingEvents.get(sessionId) ?? [];

		// Enforce buffer size limit to prevent unbounded memory growth
		if (pending.length >= SessionEventService.MAX_PENDING_EVENTS_PER_SESSION) {
			// Drop oldest event to make room
			pending.shift();
			logger.warn("Pending events buffer full, dropped oldest event", {
				sessionId,
				bufferSize: pending.length,
			});
		}

		pending.push(update);
		this.pendingEvents.set(sessionId, pending);
		this.telemetryMaxPendingBacklog = Math.max(this.telemetryMaxPendingBacklog, pending.length);

		if (pending.length >= SessionEventService.WARN_PENDING_BACKLOG_SIZE) {
			this.warnWithCooldown("backlog", "Pending event backlog reached warning threshold", {
				sessionId,
				backlogSize: pending.length,
			});
		}

		// Track when we first started buffering for this session
		if (!this.pendingEventTimestamps.has(sessionId)) {
			this.pendingEventTimestamps.set(sessionId, Date.now());
			this.scheduleOrphanedEventCleanup(sessionId);
		}

		logger.debug("Buffered event for pending session", {
			sessionId,
			type: update.type,
			bufferSize: pending.length,
		});
	}

	private startTelemetryReporter(): void {
		if (this.telemetryIntervalId !== null) {
			return;
		}
		this.telemetryWindowStartMs = Date.now();
		this.telemetryEventCount = 0;
		this.telemetryDisconnectedDrops = 0;
		this.telemetryMaxPendingBacklog = 0;
		this.telemetryMaxReplayChunkDurationMs = 0;
		this.telemetryMaxReplayChunkSize = 0;

		this.telemetryIntervalId = setInterval(() => {
			const now = Date.now();
			const elapsedMs = Math.max(1, now - this.telemetryWindowStartMs);
			const eventsPerSecond = (this.telemetryEventCount * 1000) / elapsedMs;

			if (logger.isLevelEnabled("debug")) {
				logger.debug("Session event telemetry", {
					intervalMs: elapsedMs,
					eventsPerSecond: Number(eventsPerSecond.toFixed(2)),
					events: this.telemetryEventCount,
					disconnectedDrops: this.telemetryDisconnectedDrops,
					maxPendingBacklog: this.telemetryMaxPendingBacklog,
					maxReplayChunkDurationMs: Number(this.telemetryMaxReplayChunkDurationMs.toFixed(2)),
					maxReplayChunkSize: this.telemetryMaxReplayChunkSize,
				});
			}

			if (eventsPerSecond > SessionEventService.WARN_EVENTS_PER_SECOND) {
				this.warnWithCooldown("events", "Session update throughput exceeded warning threshold", {
					eventsPerSecond: Number(eventsPerSecond.toFixed(2)),
					events: this.telemetryEventCount,
					intervalMs: elapsedMs,
				});
			}

			this.telemetryWindowStartMs = now;
			this.telemetryEventCount = 0;
			this.telemetryDisconnectedDrops = 0;
			this.telemetryMaxPendingBacklog = 0;
			this.telemetryMaxReplayChunkDurationMs = 0;
			this.telemetryMaxReplayChunkSize = 0;
		}, SessionEventService.TELEMETRY_REPORT_INTERVAL_MS);
	}

	private stopTelemetryReporter(): void {
		if (this.telemetryIntervalId !== null) {
			clearInterval(this.telemetryIntervalId);
			this.telemetryIntervalId = null;
		}
	}

	private recordInboundEvent(): void {
		this.telemetryEventCount++;
	}

	private warnWithCooldown(
		key: "events" | "chunk" | "backlog" | "disconnected",
		message: string,
		data: Record<string, unknown>
	): void {
		const now = Date.now();
		const lastWarnAt = this.telemetryLastWarnAt.get(key) ?? 0;
		if (now - lastWarnAt < SessionEventService.TELEMETRY_WARN_COOLDOWN_MS) {
			return;
		}
		this.telemetryLastWarnAt.set(key, now);
		logger.warn(message, data);
	}

	private nowMs(): number {
		return typeof performance !== "undefined" ? performance.now() : Date.now();
	}
}
