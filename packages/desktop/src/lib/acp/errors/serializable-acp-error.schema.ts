import { decodeUnknown } from "@acepe/effect-result/decodeUnknown";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { FailureReason } from "$lib/services/acp-types.js";

/**
 * Effect Schema for SerializableAcpError types that match the Rust SerializableAcpError enum.
 * These are used for IPC communication and are validated on the frontend.
 */

const AgentNotFoundSchema = Schema.Struct({
	type: Schema.Literal("agent_not_found"),
	data: Schema.Struct({ agent_id: Schema.String }),
});

const NoProviderConfiguredSchema = Schema.Struct({
	type: Schema.Literal("no_provider_configured"),
});

const SessionNotFoundSchema = Schema.Struct({
	type: Schema.Literal("session_not_found"),
	data: Schema.Struct({ session_id: Schema.String }),
});

const ClientNotStartedSchema = Schema.Struct({
	type: Schema.Literal("client_not_started"),
});

const OpenCodeServerNotRunningSchema = Schema.Struct({
	type: Schema.Literal("opencode_server_not_running"),
});

const SubprocessSpawnFailedSchema = Schema.Struct({
	type: Schema.Literal("subprocess_spawn_failed"),
	data: Schema.Struct({ command: Schema.String, error: Schema.String }),
});

const JsonRpcErrorSchema = Schema.Struct({
	type: Schema.Literal("json_rpc_error"),
	data: Schema.Struct({ message: Schema.String }),
});

const ProtocolErrorSchema = Schema.Struct({
	type: Schema.Literal("protocol_error"),
	data: Schema.Struct({ message: Schema.String }),
});

const HttpErrorSchema = Schema.Struct({
	type: Schema.Literal("http_error"),
	data: Schema.Struct({ message: Schema.String }),
});

const SerializationErrorSchema = Schema.Struct({
	type: Schema.Literal("serialization_error"),
	data: Schema.Struct({ message: Schema.String }),
});

const ChannelClosedSchema = Schema.Struct({
	type: Schema.Literal("channel_closed"),
});

const TimeoutSchema = Schema.Struct({
	type: Schema.Literal("timeout"),
	data: Schema.Struct({ operation: Schema.String }),
});

const InvalidStateSchema = Schema.Struct({
	type: Schema.Literal("invalid_state"),
	data: Schema.Struct({ message: Schema.String }),
});

const CreationFailureKindSchema = Schema.Literals([
	"provider_failed_before_id",
	"invalid_provider_session_id",
	"provider_identity_mismatch",
	"metadata_commit_failed",
	"launch_token_unavailable",
	"creation_attempt_expired",
]);

/**
 * Mirrors the Rust `FailureReason` taxonomy (`acp-types.ts`). The
 * `_failureReasonInSync` assertion below makes this a compile error if the
 * canonical union and this enum ever drift, so a new reason can't slip past
 * `bun run check`.
 */
const FailureReasonSchema = Schema.Literals([
	"deterministicRestoreFault",
	"activationFailed",
	"resumeFailed",
	"sessionGoneUpstream",
	"sessionArchivedUpstream",
	"providerSessionMismatch",
	"corruptedPersistedState",
	"explicitErrorHandlingRequired",
	"legacyIrrecoverable",
]);

// Compile-time bidirectional equality between the canonical `FailureReason`
// union and the Schema literals above. Either side gaining a member the other lacks
// collapses this type to `never` and fails the assignment.
type FailureReasonsInSync = [typeof FailureReasonSchema.Type] extends [FailureReason]
	? [FailureReason] extends [typeof FailureReasonSchema.Type]
		? true
		: never
	: never;
const _failureReasonInSync: FailureReasonsInSync = true;
void _failureReasonInSync;

const CreationFailedSchema = Schema.Struct({
	type: Schema.Literal("creation_failed"),
	data: Schema.Struct({
		kind: CreationFailureKindSchema,
		message: Schema.String,
		sessionId: Schema.NullOr(Schema.String),
		creationAttemptId: Schema.NullOr(Schema.String),
		retryable: Schema.Boolean,
		// Canonical classification shared with the resume path. Always emitted by
		// current Rust, but optional+nullable to tolerate older payloads.
		failureReason: Schema.optionalKey(Schema.NullishOr(FailureReasonSchema)),
	}),
});

const AuthenticationRequiredSchema = Schema.Struct({
	type: Schema.Literal("authentication_required"),
	data: Schema.Struct({ agent: Schema.String, instructions: Schema.String }),
});

const ProviderHistoryFailureKindSchema = Schema.Literals([
	"provider_unavailable",
	"provider_history_missing",
	"provider_unparseable",
	"provider_validation_failed",
	"stale_lineage_recovery",
	"internal",
]);

const ProviderHistoryFailedSchema = Schema.Struct({
	type: Schema.Literal("provider_history_failed"),
	data: Schema.Struct({
		kind: ProviderHistoryFailureKindSchema,
		message: Schema.String,
		sessionId: Schema.NullOr(Schema.String),
		retryable: Schema.Boolean,
	}),
});

const ViewportSessionNotAttachedSchema = Schema.Struct({
	type: Schema.Literal("viewport_session_not_attached"),
	data: Schema.Struct({ session_id: Schema.String }),
});

/**
 * Combined schema for all SerializableAcpError variants.
 */
export const SerializableAcpErrorSchema = Schema.Union([
	AgentNotFoundSchema,
	NoProviderConfiguredSchema,
	SessionNotFoundSchema,
	ClientNotStartedSchema,
	OpenCodeServerNotRunningSchema,
	SubprocessSpawnFailedSchema,
	JsonRpcErrorSchema,
	ProtocolErrorSchema,
	HttpErrorSchema,
	SerializationErrorSchema,
	ChannelClosedSchema,
	TimeoutSchema,
	InvalidStateSchema,
	CreationFailedSchema,
	AuthenticationRequiredSchema,
	ProviderHistoryFailedSchema,
	ViewportSessionNotAttachedSchema,
]);

/**
 * Type inferred from the schema.
 */
export type SerializableAcpError = typeof SerializableAcpErrorSchema.Type;

const decodeSerializableAcpError = decodeUnknown(SerializableAcpErrorSchema, () => null);

/**
 * Validates and parses an unknown value as a SerializableAcpError.
 *
 * @param value - The unknown value to validate
 * @returns The parsed SerializableAcpError if valid, null otherwise
 */
export function parseSerializableAcpError(value: unknown): SerializableAcpError | null {
	const decoded = decodeSerializableAcpError(value);
	return Result.isSuccess(decoded) ? decoded.success : null;
}
