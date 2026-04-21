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
import { SvelteMap } from "svelte/reactivity";

import type {
	AvailableCommand,
	ConfigOptionData,
	JsonValue,
	PlanData,
	SessionUpdate,
	UsageTelemetryData,
} from "../../services/converted-session-types.js";
import type {
	SessionModelState,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionStateEnvelope,
} from "../../services/acp-types.js";
import type { AppError } from "../errors/app-error.js";
import { AgentError } from "../errors/app-error.js";
import { EventSubscriber } from "../logic/event-subscriber";
import { createLogger } from "../utils/logger.js";
import { rawStreamingStore } from "./raw-streaming-store.svelte.js";
import type { SessionEventHandler } from "./session-event-handler.js";

const logger = createLogger({ id: "session-event-service", name: "SessionEventService" });

type PendingSessionEvent =
	| { kind: "sessionUpdate"; update: SessionUpdate; envelopeSeq: number | null }
	| { kind: "sessionState"; envelope: SessionStateEnvelope };

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

/** Data payload delivered with a connectionComplete lifecycle event. */
export interface ConnectionCompleteData {
	models: SessionModelState;
	modes: { currentModeId?: string; availableModes?: Array<{ id: string; name: string; description?: string | null }> };
	availableCommands: AvailableCommand[];
	configOptions: ConfigOptionData[];
	autonomousEnabled: boolean;
}

function materializedConnectionData(
	capabilities: SessionGraphCapabilities
): ConnectionCompleteData | null {
	if (!capabilities.models || !capabilities.modes) {
		return null;
	}

	return {
		models: capabilities.models,
		modes: capabilities.modes,
		availableCommands: capabilities.availableCommands ?? [],
		configOptions: capabilities.configOptions ?? [],
		autonomousEnabled: capabilities.autonomousEnabled ?? false,
	};
}

export interface SessionEventServiceCallbacks {
	onPlanUpdate?: (sessionId: string, planData: PlanData) => void;
	onTurnComplete?: (sessionId: string) => void;
}

/** Internal entry for a pending canonical connection waiter. */
interface ConnectionMaterializationWaiter {
	minGraphRevision: number;
	capabilities: SessionGraphCapabilities | null;
	lifecycle: SessionGraphLifecycle | null;
	resolve: (data: ConnectionCompleteData) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
}

export class SessionEventService {
	// Event subscriber for session updates
	private eventSubscriber: EventSubscriber | null = null;
	private sessionUpdateSubscriptionId: string | null = null;
	private sessionStateSubscriptionId: string | null = null;
	// Pending events buffer for sessions being created (race condition handling)
	private pendingEvents = new SvelteMap<string, PendingSessionEvent[]>();
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
	private processedSessionUpdateSeqs = new SvelteMap<number, number>();
	private static readonly PROCESSED_SESSION_UPDATE_TTL_MS = 15 * 60 * 1000;

	// Callbacks for permission/question handling
	private callbacks: SessionEventServiceCallbacks = {};

	// Canonical connection waiters — per-session promises awaiting ready/error envelopes.
	private connectionMaterializationWaiters = new Map<string, ConnectionMaterializationWaiter>();
	private latestSessionStateGraphRevision = new SvelteMap<string, number>();

	/**
	 * Set callbacks for handling permission and question requests.
	 */
	setCallbacks(callbacks: SessionEventServiceCallbacks): void {
		this.callbacks = callbacks;
	}

	/**
	 * Subscribe to the canonical connection outcome for a single connect attempt.
	 * Returns a promise that resolves on canonical ready state, rejects on
	 * canonical error state or timeout. Subscription is automatically cleaned
	 * up on resolution — call `cancel()` to clean up early (e.g. if the
	 * invoke itself fails before Rust can emit an event).
	 *
	 * MUST be called BEFORE firing the Tauri invoke so the listener is
	 * in place before the SSE event can possibly arrive.
	 */
	waitForConnectionMaterialization(
		sessionId: string,
		timeoutMs: number
	): { promise: Promise<ConnectionCompleteData>; cancel: () => void } {
		this.cancelConnectionMaterializationWaiter(sessionId);

		let waiterResolve!: (data: ConnectionCompleteData) => void;
		let waiterReject!: (error: Error) => void;
		const promise = new Promise<ConnectionCompleteData>((resolve, reject) => {
			waiterResolve = resolve;
			waiterReject = reject;
		});
		const minGraphRevision = this.latestSessionStateGraphRevision.get(sessionId) ?? 0;

		const timeoutId = setTimeout(() => {
			const waiter = this.takeConnectionMaterializationWaiter(sessionId);
			if (!waiter) {
				return;
			}
			waiter.reject(
				new Error(`Watchdog timeout: no response from Rust within ${timeoutMs / 1000}s`)
			);
		}, timeoutMs);

		this.connectionMaterializationWaiters.set(sessionId, {
			minGraphRevision,
			capabilities: null,
			lifecycle: null,
			resolve: waiterResolve,
			reject: waiterReject,
			timeoutId,
		});

		const cancel = () => {
			this.cancelConnectionMaterializationWaiter(sessionId);
		};

		return { promise, cancel };
	}

	/**
	 * Cancel a pending lifecycle waiter without resolving or rejecting.
	 */
	cancelConnectionMaterializationWaiter(sessionId: string): void {
		const waiter = this.connectionMaterializationWaiters.get(sessionId);
		if (waiter) {
			clearTimeout(waiter.timeoutId);
			this.connectionMaterializationWaiters.delete(sessionId);
		}
	}

	private takeConnectionMaterializationWaiter(
		sessionId: string
	): ConnectionMaterializationWaiter | undefined {
		const waiter = this.connectionMaterializationWaiters.get(sessionId);
		if (!waiter) {
			return undefined;
		}
		clearTimeout(waiter.timeoutId);
		this.connectionMaterializationWaiters.delete(sessionId);
		return waiter;
	}

	/**
	 * Initialize session update subscription.
	 */
	initializeSessionUpdates(handler: SessionEventHandler): ResultAsync<void, AppError> {
		if (this.eventSubscriber && this.sessionUpdateSubscriptionId && this.sessionStateSubscriptionId) {
			return okAsync(undefined);
		}
		// Recover from a partial/failed initialization attempt.
		if (this.eventSubscriber && (!this.sessionUpdateSubscriptionId || !this.sessionStateSubscriptionId)) {
			this.eventSubscriber = null;
		}

		const subscriber = new EventSubscriber();
		return subscriber
			.subscribe((update: SessionUpdate, envelopeSeq: number) => {
				this.handleSessionUpdate(update, handler, envelopeSeq);
			})
			.andThen((sessionUpdateId) => {
				this.sessionUpdateSubscriptionId = sessionUpdateId;
				return subscriber.subscribeSessionState((envelope: SessionStateEnvelope) => {
					this.handleSessionStateEnvelope(envelope, handler);
				});
			})
			.map((sessionStateSubscriptionId) => {
				this.eventSubscriber = subscriber;
				this.sessionStateSubscriptionId = sessionStateSubscriptionId;
				this.startTelemetryReporter();
				logger.debug("Session update subscription initialized", {
					sessionSubscriptionId: this.sessionUpdateSubscriptionId,
					sessionStateSubscriptionId: this.sessionStateSubscriptionId,
				});
				return undefined;
			})
			.mapErr((error) => {
				subscriber.unsubscribe();
				this.eventSubscriber = null;
				this.sessionUpdateSubscriptionId = null;
				this.sessionStateSubscriptionId = null;
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
		for (const waiter of this.connectionMaterializationWaiters.values()) {
			clearTimeout(waiter.timeoutId);
		}
		this.connectionMaterializationWaiters.clear();
		this.latestSessionStateGraphRevision.clear();
		this.processedSessionUpdateSeqs.clear();
		this.stopTelemetryReporter();

		if (this.eventSubscriber) {
			this.eventSubscriber.unsubscribe();
			this.eventSubscriber = null;
		}
		this.sessionUpdateSubscriptionId = null;
		this.sessionStateSubscriptionId = null;
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

	handleSessionUpdate(
		update: SessionUpdate,
		handler: SessionEventHandler,
		envelopeSeq?: number
	): void {
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

		if (logger.isLevelEnabled("debug")) {
			logger.debug("Received session update", {
				type: update.type,
				sessionId,
			});
		}

		// Record raw event for debugging (dev mode only)
		if (update.type === "connectionComplete") {
			if (this.shouldDropProcessedSessionUpdate(envelopeSeq, sessionId, update.type)) {
				return;
			}
			this.recordInboundEvent();
			rawStreamingStore.record(sessionId, update);
			logger.info("Connection complete event received", {
				sessionId,
				attemptId: update.attempt_id,
				autonomousEnabled: update.autonomous_enabled,
			});
			return;
		}

		if (update.type === "connectionFailed") {
			if (this.shouldDropProcessedSessionUpdate(envelopeSeq, sessionId, update.type)) {
				return;
			}
			this.recordInboundEvent();
			rawStreamingStore.record(sessionId, update);
			logger.error("Connection failed event received", {
				sessionId,
				attemptId: update.attempt_id,
				error: update.error,
			});
			return;
		}

		// Check if session exists in store.
		// Do NOT gate on preloaded/entries, because freshly resumed sessions can have zero entries.
		const hasSession = this.hasKnownSession(handler, sessionId);

		if (!hasSession) {
			this.bufferPendingEvent(sessionId, update, envelopeSeq);
			return;
		}

		if (this.shouldDropProcessedSessionUpdate(envelopeSeq, sessionId, update.type)) {
			return;
		}
		this.recordInboundEvent();

		// Record raw event for debugging (dev mode only)
		rawStreamingStore.record(sessionId, update);

		if (update.type === "agentMessageChunk" || update.type === "agentThoughtChunk") {
			return;
		}

		switch (update.type) {
			case "toolCall":
				logger.debug("toolCall received on raw lane", {
					sessionId,
					toolCallId: update.tool_call.id,
					toolName: update.tool_call.name,
					toolKind: update.tool_call.kind,
				});
				break;

			case "toolCallUpdate":
				logger.debug("toolCallUpdate received on raw lane", {
					sessionId,
					toolCallId: update.update.toolCallId,
					status: update.update.status,
				});
				break;

			case "permissionRequest":
				logger.debug("permissionRequest received on raw lane", {
					sessionId,
					interactionId: update.permission.id,
				});
				break;

			case "questionRequest":
				logger.debug("questionRequest received on raw lane", {
					sessionId,
					interactionId: update.question.id,
				});
				break;

			case "availableCommandsUpdate":
				logger.debug("availableCommandsUpdate received on raw lane", {
					sessionId,
					commandCount: update.update.availableCommands.length,
				});
				break;

			case "turnComplete":
				logger.info("Turn complete received on raw lane", {
					sessionId,
					updateSessionId: update.session_id,
					turnId: update.turn_id,
				});
				break;

			case "turnError":
				logger.error("Turn error received on raw lane", {
					sessionId,
					error: update.error,
					turnId: update.turn_id,
				});
				break;

			case "plan":
				this.callbacks.onPlanUpdate?.(sessionId, update.plan);
				break;

			case "userMessageChunk":
				// User chunks are turn boundaries for assistant aggregation.
				// Clear stale assistant message tracking so a subsequent assistant
				// chunk starts a new entry instead of appending to the previous turn.
				handler.clearStreamingAssistantEntry(sessionId);
				break;

			case "currentModeUpdate":
				logger.debug("currentModeUpdate received on raw lane", {
					sessionId,
					currentModeId: update.update.currentModeId,
				});
				break;

			case "configOptionUpdate": {
				logger.debug("configOptionUpdate received on raw lane", {
					sessionId,
					optionCount: update.update.configOptions.length,
					options: update.update.configOptions.map((o) => ({
						id: o.id,
						category: o.category,
						optionsCount: o.options?.length ?? 0,
						currentValue: o.currentValue,
					})),
				});
				break;
			}

			case "usageTelemetryUpdate": {
				logger.debug("usageTelemetryUpdate received on raw lane", {
					sessionId,
					updateSessionId: getUsageTelemetryData(update)?.sessionId ?? null,
				});
				break;
			}

			default: {
				update satisfies never;
			}
		}
	}

	handleSessionStateEnvelope(envelope: SessionStateEnvelope, handler: SessionEventHandler): void {
		this.latestSessionStateGraphRevision.set(
			envelope.sessionId,
			Math.max(this.latestSessionStateGraphRevision.get(envelope.sessionId) ?? 0, envelope.graphRevision)
		);
		this.advanceConnectionMaterializationWaiter(envelope);
		if (!this.hasKnownSession(handler, envelope.sessionId)) {
			this.bufferPendingSessionState(envelope.sessionId, envelope);
			return;
		}
		handler.applySessionStateEnvelope(envelope.sessionId, envelope);
	}

	private shouldDropProcessedSessionUpdate(
		envelopeSeq: number | undefined,
		sessionId: string,
		updateType: SessionUpdate["type"]
	): boolean {
		if (envelopeSeq === undefined) {
			return false;
		}

		const now = this.nowMs();
		const cutoff = now - SessionEventService.PROCESSED_SESSION_UPDATE_TTL_MS;
		for (const [seq, processedAtMs] of this.processedSessionUpdateSeqs.entries()) {
			if (processedAtMs < cutoff) {
				this.processedSessionUpdateSeqs.delete(seq);
			}
		}

		if (this.processedSessionUpdateSeqs.has(envelopeSeq)) {
			logger.warn("Dropping duplicate session update envelope", {
				sessionId,
				updateType,
				envelopeSeq,
			});
			return true;
		}

		this.processedSessionUpdateSeqs.set(envelopeSeq, now);
		return false;
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
		pending: PendingSessionEvent[],
		handler: SessionEventHandler,
		offset: number
	): void {
		const chunkStart = this.nowMs();
		const end = Math.min(offset + SessionEventService.PENDING_FLUSH_CHUNK_SIZE, pending.length);
		const chunkSize = end - offset;

		for (let i = offset; i < end; i++) {
			const pendingEvent = pending[i];
			if (pendingEvent.kind === "sessionUpdate") {
				this.handleSessionUpdate(
					pendingEvent.update,
					handler,
					pendingEvent.envelopeSeq ?? undefined
				);
				continue;
			}
			this.handleSessionStateEnvelope(pendingEvent.envelope, handler);
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

	private advanceConnectionMaterializationWaiter(envelope: SessionStateEnvelope): void {
		const waiter = this.connectionMaterializationWaiters.get(envelope.sessionId);
		if (!waiter || envelope.graphRevision <= waiter.minGraphRevision) {
			return;
		}

		if (envelope.payload.kind === "snapshot") {
			waiter.lifecycle = envelope.payload.graph.lifecycle;
			waiter.capabilities = envelope.payload.graph.capabilities;
		} else if (envelope.payload.kind === "lifecycle") {
			waiter.lifecycle = envelope.payload.lifecycle;
		} else if (envelope.payload.kind === "capabilities") {
			waiter.capabilities = envelope.payload.capabilities;
		}

		if (waiter.lifecycle?.status === "error") {
			this.takeConnectionMaterializationWaiter(envelope.sessionId)?.reject(
				new Error(waiter.lifecycle.errorMessage ?? "Connection failed")
			);
			return;
		}

		if (waiter.lifecycle?.status !== "ready" || waiter.capabilities === null) {
			return;
		}

		const materialized = materializedConnectionData(waiter.capabilities);
		if (materialized === null) {
			return;
		}

		this.takeConnectionMaterializationWaiter(envelope.sessionId)?.resolve(materialized);
	}

	/**
	 * Buffer event for session that may still be creating (race condition).
	 */
	private bufferPendingEvent(
		sessionId: string,
		update: SessionUpdate,
		envelopeSeq?: number
	): void {
		this.bufferPending(sessionId, {
			kind: "sessionUpdate",
			update,
			envelopeSeq: envelopeSeq ?? null,
		});
	}

	private bufferPendingSessionState(sessionId: string, envelope: SessionStateEnvelope): void {
		this.bufferPending(sessionId, {
			kind: "sessionState",
			envelope,
		});
	}

	private bufferPending(sessionId: string, pendingEvent: PendingSessionEvent): void {
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

		pending.push(pendingEvent);
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
			type:
				pendingEvent.kind === "sessionUpdate"
					? pendingEvent.update.type
					: "sessionState",
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
