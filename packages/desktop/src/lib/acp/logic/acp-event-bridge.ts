import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { JsonValue } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import type { AcpError } from "../errors/index.js";
import { ProtocolError } from "../errors/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({
	id: LOGGER_IDS.EVENT_SUBSCRIBER,
	name: "ACP Event Bridge",
});

type JsonObject = { [key: string]: JsonValue };

export interface AcpEventEnvelope {
	seq: number;
	eventName: string;
	sessionId: string | null;
	payload: JsonValue;
	priority: string;
	droppable: boolean;
	emittedAtMs: number;
}

const parseJsonValue = fromThrowable(
	(raw: string): JsonValue => JSON.parse(raw) as JsonValue,
	(error) => new ProtocolError(`Failed to parse ACP event payload: ${String(error)}`, error)
);

const createEventSource = fromThrowable(
	(url: string): EventSource => new EventSource(url),
	(error) => new ProtocolError(`Failed to create EventSource: ${String(error)}`, error)
);

export type AcpEventDrainScheduler = (callback: () => void) => void;

export interface AcpEventDrainOptions {
	readonly maxBatchSize?: number;
	readonly maxBatchMs?: number;
	readonly now?: () => number;
	readonly schedule?: AcpEventDrainScheduler;
}

const DEFAULT_EVENT_DRAIN_BATCH_SIZE = 12;
const DEFAULT_EVENT_DRAIN_BATCH_MS = 8;

function scheduleMacrotask(callback: () => void): void {
	setTimeout(callback, 0);
}

export function createAcpEventDrain(
	onEnvelope: (envelope: AcpEventEnvelope) => void,
	options: AcpEventDrainOptions = {}
): (envelope: AcpEventEnvelope) => void {
	const queue: AcpEventEnvelope[] = [];
	const maxBatchSize = options.maxBatchSize ?? DEFAULT_EVENT_DRAIN_BATCH_SIZE;
	const maxBatchMs = options.maxBatchMs ?? DEFAULT_EVENT_DRAIN_BATCH_MS;
	const now = options.now ?? (() => performance.now());
	const schedule = options.schedule ?? scheduleMacrotask;
	let scheduled = false;

	const drain = () => {
		scheduled = false;
		const startedAt = now();
		let processed = 0;

		while (queue.length > 0) {
			const nextEnvelope = queue.shift();
			if (nextEnvelope === undefined) {
				break;
			}

			onEnvelope(nextEnvelope);
			processed += 1;

			if (processed >= maxBatchSize || now() - startedAt >= maxBatchMs) {
				break;
			}
		}

		if (queue.length > 0 && !scheduled) {
			scheduled = true;
			schedule(drain);
		}
	};

	return (envelope) => {
		queue.push(envelope);
		if (scheduled) {
			return;
		}
		scheduled = true;
		schedule(drain);
	};
}

function isJsonObject(value: JsonValue): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonObject(value: JsonValue): Result.Result<JsonObject, ProtocolError> {
	if (!isJsonObject(value)) {
		return Result.fail(new ProtocolError("ACP event envelope must be a JSON object"));
	}
	return Result.succeed(value);
}

function readNumberField(object: JsonObject, field: string): Result.Result<number, ProtocolError> {
	const value = object[field];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return Result.fail(new ProtocolError(`ACP event envelope.${field} must be a finite number`));
	}
	return Result.succeed(value);
}

function readStringField(object: JsonObject, field: string): Result.Result<string, ProtocolError> {
	const value = object[field];
	if (typeof value !== "string") {
		return Result.fail(new ProtocolError(`ACP event envelope.${field} must be a string`));
	}
	return Result.succeed(value);
}

function readOptionalStringField(
	object: JsonObject,
	field: string
): Result.Result<string | null, ProtocolError> {
	const value = object[field];
	if (value === null || value === undefined) {
		return Result.succeed(null);
	}
	if (typeof value !== "string") {
		return Result.fail(new ProtocolError(`ACP event envelope.${field} must be a string or null`));
	}
	return Result.succeed(value);
}

function readBooleanField(
	object: JsonObject,
	field: string
): Result.Result<boolean, ProtocolError> {
	const value = object[field];
	if (typeof value !== "boolean") {
		return Result.fail(new ProtocolError(`ACP event envelope.${field} must be a boolean`));
	}
	return Result.succeed(value);
}

export function parseAcpEventEnvelope(raw: string): Result.Result<AcpEventEnvelope, ProtocolError> {
	return Effect.runSync(Effect.result(parseJsonValue(raw))).pipe(
		Result.andThen(asJsonObject),
		Result.andThen((object) =>
			readNumberField(object, "seq").pipe(
				Result.andThen((seq) =>
					readStringField(object, "eventName").pipe(
						Result.andThen((eventName) =>
							readOptionalStringField(object, "sessionId").pipe(
								Result.andThen((sessionId) =>
									readStringField(object, "priority").pipe(
										Result.andThen((priority) =>
											readBooleanField(object, "droppable").pipe(
												Result.andThen((droppable) =>
													readNumberField(object, "emittedAtMs").pipe(
														Result.map((emittedAtMs) => {
															const payload = object.payload ?? null;
															return {
																seq,
																eventName,
																sessionId,
																payload,
																priority,
																droppable,
																emittedAtMs,
															};
														})
													)
												)
											)
										)
									)
								)
							)
						)
					)
				)
			)
		)
	);
}

export function openAcpEventSource(
	onEnvelope: (envelope: AcpEventEnvelope) => void
): Effect.Effect<() => void, AcpError> {
	return tauriClient.acp.getEventBridgeInfo().pipe(
		Effect.flatMap((bridgeInfo) => {
			const sourceResult = Effect.runSync(Effect.result(createEventSource(bridgeInfo.eventsUrl)));
			if (Result.isFailure(sourceResult)) {
				return Effect.fail(sourceResult.failure);
			}

			const source = sourceResult.success;
			let sseEventCount = 0;
			let sseLastReportTime = Date.now();
			const enqueueEnvelope = createAcpEventDrain(onEnvelope);
			source.onmessage = (event: MessageEvent<string>) => {
				// DEBUG: Track SSE event rate to detect floods
				sseEventCount++;
				const now = Date.now();
				if (now - sseLastReportTime > 1000) {
					if (sseEventCount > 50) {
						console.warn(`[SSE_FLOOD] ${sseEventCount} events in ${now - sseLastReportTime}ms`);
					}
					sseEventCount = 0;
					sseLastReportTime = now;
				}

				const t0 = performance.now();
				const envelopeResult = parseAcpEventEnvelope(event.data);
				if (Result.isFailure(envelopeResult)) {
					logger.warn("Discarding malformed ACP bridge event", { error: envelopeResult.failure });
					return;
				}
				enqueueEnvelope(envelopeResult.success);
				const dt = performance.now() - t0;
				if (dt > 50) {
					console.warn(`[SSE_SLOW] Event processing took ${dt.toFixed(1)}ms`, {
						eventName: envelopeResult.success.eventName,
						sessionId: envelopeResult.success.sessionId,
						seq: envelopeResult.success.seq,
					});
				}
			};
			source.onerror = () => {
				logger.warn("ACP bridge EventSource reported an error");
			};

			const cleanup = () => {
				source.onmessage = null;
				source.onerror = null;
				source.close();
			};

			return Effect.succeed(cleanup);
		})
	);
}
