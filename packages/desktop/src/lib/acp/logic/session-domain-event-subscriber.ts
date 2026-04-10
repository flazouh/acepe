import { okAsync, Result, ResultAsync } from "neverthrow";

import type { SessionDomainEvent } from "../../services/acp-types.js";
import type { JsonValue } from "../../services/converted-session-types.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import { type AcpError, ProtocolError } from "../errors/index.js";
import { createLogger } from "../utils/logger.js";
import { openAcpEventSource } from "./acp-event-bridge.js";

type JsonObject = { [key: string]: JsonValue };

const SESSION_DOMAIN_EVENT_KIND_LOOKUP: Record<SessionDomainEvent["kind"], true> = {
	session_identity_resolved: true,
	session_connected: true,
	session_disconnected: true,
	session_config_changed: true,
	turn_started: true,
	turn_completed: true,
	turn_failed: true,
	turn_cancelled: true,
	user_message_segment_appended: true,
	assistant_message_segment_appended: true,
	assistant_thought_segment_appended: true,
	operation_upserted: true,
	operation_child_linked: true,
	operation_completed: true,
	interaction_upserted: true,
	interaction_resolved: true,
	interaction_cancelled: true,
	usage_telemetry_updated: true,
	todo_state_updated: true,
};

const invokeListener = Result.fromThrowable(
	(listener: (event: SessionDomainEvent) => void, event: SessionDomainEvent) => listener(event),
	(error) => error
);

function isJsonObject(value: JsonValue): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionDomainEventKind(value: JsonValue): value is SessionDomainEvent["kind"] {
	return typeof value === "string" && Object.hasOwn(SESSION_DOMAIN_EVENT_KIND_LOOKUP, value);
}

export function parseSessionDomainEventPayload(payload: JsonValue): SessionDomainEvent | null {
	if (!isJsonObject(payload)) {
		return null;
	}

	const eventId = payload.event_id;
	const seq = payload.seq;
	const sessionId = payload.session_id;
	const providerSessionId = payload.provider_session_id;
	const occurredAtMs = payload.occurred_at_ms;
	const causationId = payload.causation_id;
	const kind = payload.kind;

	if (typeof eventId !== "string") {
		return null;
	}
	if (typeof seq !== "number" || !Number.isFinite(seq)) {
		return null;
	}
	if (typeof sessionId !== "string") {
		return null;
	}
	if (!(typeof providerSessionId === "string" || providerSessionId === null)) {
		return null;
	}
	if (typeof occurredAtMs !== "number" || !Number.isFinite(occurredAtMs)) {
		return null;
	}
	if (!(typeof causationId === "string" || causationId === null)) {
		return null;
	}
	if (!isSessionDomainEventKind(kind)) {
		return null;
	}

	return payload as SessionDomainEvent;
}

/**
 * Subscribes to canonical session domain events emitted over the ACP bridge.
 *
 * This subscriber keeps the new `acp-session-domain-event` stream additive so it
 * can coexist with the legacy `acp-session-update` flow during migration.
 */
export class SessionDomainEventSubscriber {
	private unlistenFn: (() => void) | null = null;
	private listeners = new Map<string, (event: SessionDomainEvent) => void>();
	private listenerIdCounter = 0;
	private isInitializing = false;
	private initPromise: Promise<void> | null = null;
	private readonly logger = createLogger({
		id: LOGGER_IDS.SESSION_DOMAIN_EVENT_SUBSCRIBER,
		name: "Session Domain Event Subscriber",
	});

	subscribe(listener: (event: SessionDomainEvent) => void): ResultAsync<string, AcpError> {
		const listenerId = `session-domain-event-listener-${++this.listenerIdCounter}`;
		this.listeners.set(listenerId, listener);

		if (this.unlistenFn) {
			return okAsync(listenerId);
		}

		if (this.isInitializing && this.initPromise) {
			return ResultAsync.fromPromise(
				this.initPromise.then(() => {
					if (!this.listeners.has(listenerId)) {
						throw new Error("Listener was removed during subscriber initialization");
					}
					return listenerId;
				}),
				(error) => {
					this.listeners.delete(listenerId);
					return new ProtocolError(`Failed to wait for initialization: ${error}`, error);
				}
			);
		}

		this.isInitializing = true;
		const listenResult = openAcpEventSource((envelope) => {
			if (envelope.eventName !== "acp-session-domain-event") {
				return;
			}

			const domainEvent = parseSessionDomainEventPayload(envelope.payload);
			if (!domainEvent) {
				this.logger.warn("Discarding invalid acp-session-domain-event payload", {
					seq: envelope.seq,
					eventName: envelope.eventName,
				});
				return;
			}

			for (const [id, callback] of this.listeners.entries()) {
				const invokeResult = invokeListener(callback, domainEvent);
				if (invokeResult.isErr()) {
					this.logger.error("Listener threw error", {
						listenerId: id,
						error: invokeResult.error,
					});
				}
			}
		})
			.map((unlisten) => {
				this.isInitializing = false;
				if (this.listeners.size === 0) {
					unlisten();
					this.unlistenFn = null;
				} else {
					this.unlistenFn = unlisten;
				}
				return listenerId;
			})
			.mapErr((error) => {
				this.isInitializing = false;
				this.unlistenFn = null;
				this.listeners.delete(listenerId);
				return new ProtocolError(`Failed to subscribe to session domain events: ${error}`, error);
			});

		this.initPromise = listenResult
			.match(
				() => undefined,
				(error) => {
					throw error;
				}
			)
			.then(() => undefined)
			.finally(() => {
				this.initPromise = null;
			});

		return listenResult;
	}

	unsubscribeById(listenerId: string): void {
		this.listeners.delete(listenerId);

		if (this.listeners.size === 0 && this.unlistenFn) {
			this.unlistenFn();
			this.unlistenFn = null;
		}
	}

	unsubscribe(): void {
		this.listeners.clear();
		if (this.unlistenFn) {
			this.unlistenFn();
			this.unlistenFn = null;
		}
	}

	get listenerCount(): number {
		return this.listeners.size;
	}
}
