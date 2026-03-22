import { err, errAsync, ok, okAsync, Result, type ResultAsync } from "neverthrow";
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

const parseJsonValue = Result.fromThrowable(
	(raw: string): JsonValue => JSON.parse(raw) as JsonValue,
	(error) => new ProtocolError(`Failed to parse ACP event payload: ${String(error)}`, error)
);

const createEventSource = Result.fromThrowable(
	(url: string): EventSource => new EventSource(url),
	(error) => new ProtocolError(`Failed to create EventSource: ${String(error)}`, error)
);

function isJsonObject(value: JsonValue): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonObject(value: JsonValue): Result<JsonObject, ProtocolError> {
	if (!isJsonObject(value)) {
		return err(new ProtocolError("ACP event envelope must be a JSON object"));
	}
	return ok(value);
}

function readNumberField(object: JsonObject, field: string): Result<number, ProtocolError> {
	const value = object[field];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return err(new ProtocolError(`ACP event envelope.${field} must be a finite number`));
	}
	return ok(value);
}

function readStringField(object: JsonObject, field: string): Result<string, ProtocolError> {
	const value = object[field];
	if (typeof value !== "string") {
		return err(new ProtocolError(`ACP event envelope.${field} must be a string`));
	}
	return ok(value);
}

function readOptionalStringField(
	object: JsonObject,
	field: string
): Result<string | null, ProtocolError> {
	const value = object[field];
	if (value === null || value === undefined) {
		return ok(null);
	}
	if (typeof value !== "string") {
		return err(new ProtocolError(`ACP event envelope.${field} must be a string or null`));
	}
	return ok(value);
}

function readBooleanField(object: JsonObject, field: string): Result<boolean, ProtocolError> {
	const value = object[field];
	if (typeof value !== "boolean") {
		return err(new ProtocolError(`ACP event envelope.${field} must be a boolean`));
	}
	return ok(value);
}

export function parseAcpEventEnvelope(raw: string): Result<AcpEventEnvelope, ProtocolError> {
	return parseJsonValue(raw)
		.andThen(asJsonObject)
		.andThen((object) =>
			readNumberField(object, "seq").andThen((seq) =>
				readStringField(object, "eventName").andThen((eventName) =>
					readOptionalStringField(object, "sessionId").andThen((sessionId) =>
						readStringField(object, "priority").andThen((priority) =>
							readBooleanField(object, "droppable").andThen((droppable) =>
								readNumberField(object, "emittedAtMs").map((emittedAtMs) => {
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
		);
}

export function openAcpEventSource(
	onEnvelope: (envelope: AcpEventEnvelope) => void
): ResultAsync<() => void, AcpError> {
	return tauriClient.acp.getEventBridgeInfo().andThen((bridgeInfo) => {
		const sourceResult = createEventSource(bridgeInfo.eventsUrl);
		if (sourceResult.isErr()) {
			return errAsync(sourceResult.error);
		}

		const source = sourceResult.value;
		let sseEventCount = 0;
		let sseLastReportTime = Date.now();
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
			if (envelopeResult.isErr()) {
				logger.warn("Discarding malformed ACP bridge event", { error: envelopeResult.error });
				return;
			}
			onEnvelope(envelopeResult.value);
			const dt = performance.now() - t0;
			if (dt > 50) {
				console.warn(`[SSE_SLOW] Event processing took ${dt.toFixed(1)}ms`, {
					eventName: envelopeResult.value.eventName,
					sessionId: envelopeResult.value.sessionId,
					seq: envelopeResult.value.seq,
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

		return okAsync(cleanup);
	});
}
