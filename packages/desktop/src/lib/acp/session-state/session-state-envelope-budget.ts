import type { SessionStateEnvelope, SessionStatePayload } from "../../services/acp-types.js";

export type SessionStatePayloadKind = SessionStatePayload["kind"];

export type SessionStateEnvelopeByteBudget = {
	readonly kind: SessionStatePayloadKind;
	readonly maxBytes: number;
};

export type SessionStateEnvelopeByteBudgetResult =
	| {
			readonly ok: true;
			readonly kind: SessionStatePayloadKind;
			readonly byteLength: number;
			readonly maxBytes: number;
	  }
	| {
			readonly ok: false;
			readonly kind: SessionStatePayloadKind;
			readonly byteLength: number;
			readonly maxBytes: number;
	  };

const sessionStateEnvelopeByteBudgetResults = new WeakMap<
	SessionStateEnvelope,
	SessionStateEnvelopeByteBudgetResult
>();

const SESSION_STATE_ENVELOPE_MAX_BYTES_BY_KIND = {
	snapshot: 2_000_000,
	delta: 64_000,
	lifecycle: 8_000,
	capabilities: 128_000,
	telemetry: 16_000,
	plan: 128_000,
	assistantTextDelta: 8_000,
} satisfies Record<SessionStatePayloadKind, number>;

export const SESSION_STATE_ENVELOPE_BYTE_BUDGETS: readonly SessionStateEnvelopeByteBudget[] =
	Object.entries(SESSION_STATE_ENVELOPE_MAX_BYTES_BY_KIND).map(([kind, maxBytes]) => ({
		kind: kind as SessionStatePayloadKind,
		maxBytes,
	}));

export function getSessionStateEnvelopeByteBudget(
	kind: SessionStatePayloadKind
): number {
	return SESSION_STATE_ENVELOPE_MAX_BYTES_BY_KIND[kind];
}

export function measureSessionStateEnvelopeBytes(envelope: SessionStateEnvelope): number {
	return new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
}

export function checkSessionStateEnvelopeByteBudget(
	envelope: SessionStateEnvelope
): SessionStateEnvelopeByteBudgetResult {
	const cachedResult = sessionStateEnvelopeByteBudgetResults.get(envelope);
	if (cachedResult !== undefined) {
		return cachedResult;
	}
	const kind = envelope.payload.kind;
	const maxBytes = getSessionStateEnvelopeByteBudget(kind);
	const byteLength = measureSessionStateEnvelopeBytes(envelope);
	const result: SessionStateEnvelopeByteBudgetResult =
		byteLength <= maxBytes
			? {
					ok: true,
					kind,
					byteLength,
					maxBytes,
				}
			: {
					ok: false,
					kind,
					byteLength,
					maxBytes,
				};
	sessionStateEnvelopeByteBudgetResults.set(envelope, result);
	return result;
}
