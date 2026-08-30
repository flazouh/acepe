/**
 * Session Event Service - Manages event handling and buffering.
 *
 * Handles:
 * - Event subscription lifecycle
 * - Pending event buffering for race conditions
 * - Session update processing
 * - Permission and question request handling
 */

import * as Effect from "effect/Effect";
import { SvelteMap } from "svelte/reactivity";
import type {
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionModelState,
	SessionStateEnvelope,
} from "../../services/acp-types.js";
import type {
	AvailableCommand,
	ConfigOptionData,
	PlanData,
} from "../../services/converted-session-types.js";
import type { AppError } from "../errors/app-error.js";
import { AgentError } from "../errors/app-error.js";
import { EventSubscriber } from "../logic/event-subscriber";
import { checkSessionStateEnvelopeByteBudget } from "../session-state/session-state-envelope-budget.js";
import { createLogger } from "../utils/logger.js";
import type { SessionEventHandler } from "./session-event-handler.js";

const logger = createLogger({ id: "session-event-service", name: "SessionEventService" });

type PendingSessionEvent = { kind: "sessionState"; envelope: SessionStateEnvelope };

interface SessionStateEnvelopeFrontier {
	graphRevision: number;
	lastEventSeq: number;
}

function isOlderEnvelopeFrontier(
	current: SessionStateEnvelopeFrontier | undefined,
	incoming: SessionStateEnvelopeFrontier
): boolean {
	if (current === undefined) {
		return false;
	}

	if (incoming.graphRevision !== current.graphRevision) {
		return incoming.graphRevision < current.graphRevision;
	}

	return incoming.lastEventSeq < current.lastEventSeq;
}

function maxEnvelopeFrontier(
	current: SessionStateEnvelopeFrontier | undefined,
	incoming: SessionStateEnvelopeFrontier
): SessionStateEnvelopeFrontier {
	if (current === undefined || isOlderEnvelopeFrontier(current, incoming)) {
		return incoming;
	}
	return current;
}

/** Data payload delivered with a connectionComplete lifecycle event. */
export interface ConnectionCompleteData {
	models: SessionModelState;
	modes: {
		currentModeId?: string;
		availableModes?: Array<{
			id: string;
			name: string;
			description?: string | null;
			iconKind?: "agent" | "plan" | "autonomous" | "bypass" | "ask" | "edit" | "review" | "unknown";
		}>;
	};
	availableCommands: AvailableCommand[] | null;
	configOptions: ConfigOptionData[] | null;
	autonomousEnabled: boolean | null;
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
		availableCommands: capabilities.availableCommands ?? null,
		configOptions: capabilities.configOptions ?? null,
		autonomousEnabled: capabilities.autonomousEnabled ?? null,
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
	private telemetryMaxPendingBacklog = 0;
	private telemetryMaxReplayChunkDurationMs = 0;
	private telemetryMaxReplayChunkSize = 0;
	private telemetryLastWarnAt = new SvelteMap<"events" | "chunk" | "backlog", number>();

	// Callbacks for permission/question handling
	private callbacks: SessionEventServiceCallbacks = {};

	// Canonical connection waiters — per-session promises awaiting ready/error envelopes.
	private connectionMaterializationWaiters = new Map<string, ConnectionMaterializationWaiter>();
	private latestSessionStateEnvelopeFrontier = new SvelteMap<
		string,
		SessionStateEnvelopeFrontier
	>();

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
	 * invoke itself fails before the backend can emit an event).
	 *
	 * MUST be called BEFORE firing the backend invoke so the listener is
	 * in place before the event can possibly arrive.
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
		const minGraphRevision =
			this.latestSessionStateEnvelopeFrontier.get(sessionId)?.graphRevision ?? 0;

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
	initializeSessionUpdates(handler: SessionEventHandler): Effect.Effect<void, AppError> {
		if (this.eventSubscriber && this.sessionStateSubscriptionId) {
			return Effect.succeed(undefined);
		}
		// Recover from a partial/failed initialization attempt.
		if (this.eventSubscriber && !this.sessionStateSubscriptionId) {
			this.eventSubscriber = null;
		}

		const subscriber = new EventSubscriber();
		return subscriber
			.subscribeSessionState((envelope: SessionStateEnvelope) => {
				this.handleSessionStateEnvelope(envelope, handler);
			})
			.pipe(
				Effect.map((sessionStateSubscriptionId) => {
					this.eventSubscriber = subscriber;
					this.sessionStateSubscriptionId = sessionStateSubscriptionId;
					this.startTelemetryReporter();
					logger.debug("Session state subscription initialized", {
						sessionStateSubscriptionId: this.sessionStateSubscriptionId,
					});
					return undefined;
				}),
				Effect.mapError((error) => {
					if (this.sessionStateSubscriptionId !== null) {
						subscriber.unsubscribeById(this.sessionStateSubscriptionId);
					}
					this.eventSubscriber = null;
					this.sessionStateSubscriptionId = null;
					logger.error("Failed to initialize session state subscription", { error });
					return new AgentError(
						"initializeSessionUpdates",
						error instanceof Error ? error : new Error(String(error))
					);
				})
			);
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
		this.latestSessionStateEnvelopeFrontier.clear();
		this.stopTelemetryReporter();

		if (this.eventSubscriber && this.sessionStateSubscriptionId !== null) {
			this.eventSubscriber.unsubscribeById(this.sessionStateSubscriptionId);
		}
		this.eventSubscriber = null;
		this.sessionStateSubscriptionId = null;
	}

	handleSessionStateEnvelope(envelope: SessionStateEnvelope, handler: SessionEventHandler): void {
		const budget = checkSessionStateEnvelopeByteBudget(envelope);
		if (!budget.ok) {
			logger.warn("Rejected oversized session-state envelope at event ingress", {
				sessionId: envelope.sessionId,
				kind: budget.kind,
				byteLength: budget.byteLength,
				maxBytes: budget.maxBytes,
			});
			return;
		}

		const latestFrontier = this.latestSessionStateEnvelopeFrontier.get(envelope.sessionId);
		const incomingFrontier = {
			graphRevision: envelope.graphRevision,
			lastEventSeq: envelope.lastEventSeq,
		};
		if (isOlderEnvelopeFrontier(latestFrontier, incomingFrontier)) {
			logger.warn("Dropped stale session-state envelope at event ingress", {
				sessionId: envelope.sessionId,
				kind: envelope.payload.kind,
				graphRevision: envelope.graphRevision,
				lastEventSeq: envelope.lastEventSeq,
				latestGraphRevision: latestFrontier?.graphRevision ?? 0,
				latestLastEventSeq: latestFrontier?.lastEventSeq ?? 0,
			});
			return;
		}

		this.recordInboundEvent();
		this.latestSessionStateEnvelopeFrontier.set(
			envelope.sessionId,
			maxEnvelopeFrontier(latestFrontier, incomingFrontier)
		);
		this.advanceConnectionMaterializationWaiter(envelope);
		if (!this.hasKnownSession(handler, envelope.sessionId)) {
			if (envelope.payload.kind === "snapshot") {
				const materialized = handler.ensureSessionFromStateGraph?.(envelope.payload.graph);
				if (materialized === true) {
					handler.applySessionStateEnvelope(envelope.sessionId, envelope);
					this.flushPendingEvents(envelope.sessionId, handler);
					return;
				}
			}
			const materialized = handler.materializePendingCreationSession?.(envelope.sessionId);
			if (materialized === true) {
				handler.applySessionStateEnvelope(envelope.sessionId, envelope);
				this.flushPendingEvents(envelope.sessionId, handler);
				return;
			}
			this.bufferPendingSessionState(envelope.sessionId, envelope);
			return;
		}
		handler.applySessionStateEnvelope(envelope.sessionId, envelope);
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
			this.handleSessionStateEnvelope(pending[i].envelope, handler);
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
		return handler.getSessionIdentity(sessionId) !== undefined;
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
		}

		if (waiter.lifecycle?.status === "failed") {
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

	private bufferPendingSessionState(sessionId: string, envelope: SessionStateEnvelope): void {
		this.dropStaleBufferedSessionState(sessionId, {
			graphRevision: envelope.graphRevision,
			lastEventSeq: envelope.lastEventSeq,
		});
		this.bufferPending(sessionId, {
			kind: "sessionState",
			envelope,
		});
	}

	private dropStaleBufferedSessionState(
		sessionId: string,
		frontier: SessionStateEnvelopeFrontier
	): void {
		const pending = this.pendingEvents.get(sessionId);
		if (pending === undefined || pending.length === 0) {
			return;
		}

		const retained = pending.filter((pendingEvent) => {
			return (
				pendingEvent.kind !== "sessionState" ||
				!isOlderEnvelopeFrontier(frontier, {
					graphRevision: pendingEvent.envelope.graphRevision,
					lastEventSeq: pendingEvent.envelope.lastEventSeq,
				})
			);
		});
		if (retained.length === pending.length) {
			return;
		}
		this.pendingEvents.set(sessionId, retained);
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
			bufferSize: pending.length,
		});
	}

	private startTelemetryReporter(): void {
		if (this.telemetryIntervalId !== null) {
			return;
		}
		this.telemetryWindowStartMs = Date.now();
		this.telemetryEventCount = 0;
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
		key: "events" | "chunk" | "backlog",
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
