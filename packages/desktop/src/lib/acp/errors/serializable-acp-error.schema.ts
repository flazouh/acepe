import { z } from "zod";

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
