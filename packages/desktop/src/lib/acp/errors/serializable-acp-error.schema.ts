import { z } from "zod";
import type { FailureReason } from "$lib/services/acp-types.js";

/**
 * Zod schema for SerializableAcpError types that match the Rust SerializableAcpError enum.
 * These are used for IPC communication and are validated on the frontend.
 */

const AgentNotFoundSchema = z.object({
	type: z.literal("agent_not_found"),
	data: z.object({ agent_id: z.string() }),
});

const NoProviderConfiguredSchema = z.object({
	type: z.literal("no_provider_configured"),
});

const SessionNotFoundSchema = z.object({
	type: z.literal("session_not_found"),
	data: z.object({ session_id: z.string() }),
});

const ClientNotStartedSchema = z.object({
	type: z.literal("client_not_started"),
});

const OpenCodeServerNotRunningSchema = z.object({
	type: z.literal("opencode_server_not_running"),
});

const SubprocessSpawnFailedSchema = z.object({
	type: z.literal("subprocess_spawn_failed"),
	data: z.object({ command: z.string(), error: z.string() }),
});

const JsonRpcErrorSchema = z.object({
	type: z.literal("json_rpc_error"),
	data: z.object({ message: z.string() }),
});

const ProtocolErrorSchema = z.object({
	type: z.literal("protocol_error"),
	data: z.object({ message: z.string() }),
});

const HttpErrorSchema = z.object({
	type: z.literal("http_error"),
	data: z.object({ message: z.string() }),
});

const SerializationErrorSchema = z.object({
	type: z.literal("serialization_error"),
	data: z.object({ message: z.string() }),
});

const ChannelClosedSchema = z.object({
	type: z.literal("channel_closed"),
});

const TimeoutSchema = z.object({
	type: z.literal("timeout"),
	data: z.object({ operation: z.string() }),
});

const InvalidStateSchema = z.object({
	type: z.literal("invalid_state"),
	data: z.object({ message: z.string() }),
});

const CreationFailureKindSchema = z.enum([
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
const FailureReasonSchema = z.enum([
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
// union and the Zod enum above. Either side gaining a member the other lacks
// collapses this type to `never` and fails the assignment.
type FailureReasonsInSync = [z.infer<typeof FailureReasonSchema>] extends [FailureReason]
	? [FailureReason] extends [z.infer<typeof FailureReasonSchema>]
		? true
		: never
	: never;
const _failureReasonInSync: FailureReasonsInSync = true;
void _failureReasonInSync;

const CreationFailedSchema = z.object({
	type: z.literal("creation_failed"),
	data: z.object({
		kind: CreationFailureKindSchema,
		message: z.string(),
		sessionId: z.string().nullable(),
		creationAttemptId: z.string().nullable(),
		retryable: z.boolean(),
		// Canonical classification shared with the resume path. Always emitted by
		// current Rust, but optional+nullable to tolerate older payloads.
		failureReason: FailureReasonSchema.nullish(),
	}),
});

const AuthenticationRequiredSchema = z.object({
	type: z.literal("authentication_required"),
	data: z.object({ agent: z.string(), instructions: z.string() }),
});

const ProviderHistoryFailureKindSchema = z.enum([
	"provider_unavailable",
	"provider_history_missing",
	"provider_unparseable",
	"provider_validation_failed",
	"stale_lineage_recovery",
	"internal",
]);

const ProviderHistoryFailedSchema = z.object({
	type: z.literal("provider_history_failed"),
	data: z.object({
		kind: ProviderHistoryFailureKindSchema,
		message: z.string(),
		sessionId: z.string().nullable(),
		retryable: z.boolean(),
	}),
});

const ViewportSessionNotAttachedSchema = z.object({
	type: z.literal("viewport_session_not_attached"),
	data: z.object({ session_id: z.string() }),
});

/**
 * Combined schema for all SerializableAcpError variants.
 */
export const SerializableAcpErrorSchema = z.discriminatedUnion("type", [
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
 * Type inferred from the Zod schema.
 */
export type SerializableAcpError = z.infer<typeof SerializableAcpErrorSchema>;

/**
 * Validates and parses an unknown value as a SerializableAcpError.
 *
 * @param value - The unknown value to validate
 * @returns The parsed SerializableAcpError if valid, null otherwise
 */
export function parseSerializableAcpError(value: unknown): SerializableAcpError | null {
	const result = SerializableAcpErrorSchema.safeParse(value);
	return result.success ? result.data : null;
}
